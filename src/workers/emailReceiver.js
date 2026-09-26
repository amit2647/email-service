const { simpleParser } = require("mailparser");
const { createImapClient } = require("../config/imap");
const { processInboundEmail } = require("../services/inboundEmailService");
const {
  getReceiverState,
  createReceiverState,
  updateReceiverState,
} = require("../services/emailReceiverStateService");
const { getActiveEmailAccounts } = require("../services/emailAccountService");

function getAddress(addressObject) {
  if (!addressObject) {
    return null;
  }
  if (typeof addressObject.text === "string") {
    return addressObject.text;
  }
  if (Array.isArray(addressObject.value) && addressObject.value.length > 0) {
    return addressObject.value
      .map((entry) => entry.address || entry.name)
      .filter(Boolean)
      .join(", ");
  }
  return null;
}

function getHeader(parsed, name) {
  const value = parsed.headers.get(name);
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.join(" ");
  }
  return String(value);
}

function normalizeReferences(references) {
  if (!references) {
    return null;
  }
  if (Array.isArray(references)) {
    return references
      .filter(Boolean)
      .map((reference) => String(reference).trim())
      .filter(Boolean)
      .join(" ");
  }
  if (typeof references === "string") {
    return references.trim() || null;
  }
  return String(references).trim() || null;
}

async function processMessage(client, uid, emailAccount) {
  const emailAccountId = emailAccount.id;
  const organizationId = emailAccount.organization_id;

  console.log(`[IMAP][Account ${emailAccountId}] Fetching UID ${uid}`);

  const message = await client.fetchOne(
    uid,
    {
      source: true,
      envelope: true,
      internalDate: true,
    },
    {
      uid: true,
    },
  );

  if (!message?.source) {
    console.warn(
      `[IMAP][Account ${emailAccountId}] Unable to read message UID ${uid}`,
    );
    return null;
  }

  const parsed = await simpleParser(message.source);

  const messageId = parsed.messageId || getHeader(parsed, "message-id");
  const inReplyTo = parsed.inReplyTo || getHeader(parsed, "in-reply-to");
  const references = normalizeReferences(
    parsed.references || getHeader(parsed, "references"),
  );
  const fromAddress = getAddress(parsed.from);
  const toAddress = getAddress(parsed.to);
  const ccAddress = getAddress(parsed.cc);
  const replyTo = getAddress(parsed.replyTo);
  const subject = parsed.subject || null;
  const body = parsed.text || parsed.html || "";
  const receivedAt = message.internalDate || parsed.date || new Date();

  console.log(`[IMAP][Account ${emailAccountId}] New email received`);
  console.log(
    `[IMAP][Account ${emailAccountId}] Organization: ${organizationId}`,
  );
  console.log(`[IMAP][Account ${emailAccountId}] UID: ${uid}`);
  console.log(`[IMAP][Account ${emailAccountId}] From: ${fromAddress}`);
  console.log(`[IMAP][Account ${emailAccountId}] To: ${toAddress}`);
  console.log(`[IMAP][Account ${emailAccountId}] Subject: ${subject}`);
  console.log(`[IMAP][Account ${emailAccountId}] Message-ID: ${messageId}`);
  console.log(`[IMAP][Account ${emailAccountId}] In-Reply-To: ${inReplyTo}`);
  console.log(`[IMAP][Account ${emailAccountId}] References: ${references}`);

  const result = await processInboundEmail({
    organizationId,
    emailAccountId,
    messageId,
    inReplyTo,
    referencesHeader: references,
    fromAddress,
    toAddress,
    ccAddress,
    replyTo,
    subject,
    body,
    receivedAt,
  });

  console.log(`[IMAP][Account ${emailAccountId}] Processing result:`, result);

  return result;
}

async function getHighestUid(client) {
  const result = await client.search(
    {
      all: true,
    },
    {
      uid: true,
    },
  );

  if (!result || result.length === 0) {
    return 0;
  }

  return Math.max(...result);
}

async function processNewMessages(
  client,
  mailbox,
  emailAccount,
  lastProcessedUid,
) {
  const emailAccountId = emailAccount.id;
  const lock = await client.getMailboxLock(mailbox);

  try {
    const minimumUid = Number(lastProcessedUid) + 1;

    console.log(
      `[IMAP][Account ${emailAccountId}] Searching for UIDs >= ${minimumUid}`,
    );

    const searchResult = await client.search(
      {
        uid: `${minimumUid}:*`,
      },
      {
        uid: true,
      },
    );

    if (!searchResult || searchResult.length === 0) {
      console.log(`[IMAP][Account ${emailAccountId}] No new UIDs found`);
      return lastProcessedUid;
    }

    const newUids = searchResult
      .filter((uid) => uid >= minimumUid)
      .sort((a, b) => a - b);

    console.log(
      `[IMAP][Account ${emailAccountId}] Found ${newUids.length} new UID(s): ${newUids.join(", ")}`,
    );

    let highestSuccessfullyProcessedUid = Number(lastProcessedUid);

    for (const uid of newUids) {
      try {
        const result = await processMessage(client, uid, emailAccount);

        if (result?.matched || result?.duplicate) {
          await client.messageFlagsAdd(uid, ["\\Seen"], {
            uid: true,
          });

          console.log(
            `[IMAP][Account ${emailAccountId}] UID ${uid} marked as Seen`,
          );
        } else {
          console.log(
            `[IMAP][Account ${emailAccountId}] UID ${uid} was not matched; leaving unread`,
          );
        }

        highestSuccessfullyProcessedUid = uid;

        await updateReceiverState(
          emailAccountId,
          mailbox,
          highestSuccessfullyProcessedUid,
        );

        console.log(
          `[IMAP][Account ${emailAccountId}] Persisted checkpoint: UID ${highestSuccessfullyProcessedUid}`,
        );
      } catch (error) {
        console.error(
          `[IMAP][Account ${emailAccountId}] Failed to process UID ${uid}:`,
          error,
        );
        break;
      }
    }

    return highestSuccessfullyProcessedUid;
  } finally {
    lock.release();
  }
}

async function startAccountReceiver(emailAccount) {
  const emailAccountId = emailAccount.id;
  const mailbox = emailAccount.imap_mailbox || "INBOX";
  const client = createImapClient(emailAccount);

  let lastProcessedUid = 0;
  let processingMailbox = false;
  let mailboxChangePending = false;

  client.on("error", (error) => {
    console.error(`[IMAP][Account ${emailAccountId}] Client error:`, error);
  });

  client.on("close", () => {
    console.warn(`[IMAP][Account ${emailAccountId}] Connection closed`);
  });

  client.on("exists", (data) => {
    console.log(
      `[IMAP][Account ${emailAccountId}] EXISTS event received:`,
      data,
    );

    mailboxChangePending = true;

    processMailbox().catch((error) => {
      console.error(
        `[IMAP][Account ${emailAccountId}] Event mailbox processing failed:`,
        error,
      );
    });
  });

  await client.connect();
  await client.mailboxOpen(mailbox);

  console.log(`[IMAP][Account ${emailAccountId}] Watching mailbox: ${mailbox}`);

  let receiverState = await getReceiverState(emailAccountId, mailbox);

  if (!receiverState) {
    const currentHighestUid = await getHighestUid(client);

    receiverState = await createReceiverState(
      emailAccountId,
      mailbox,
      currentHighestUid,
    );

    console.log(
      `[IMAP][Account ${emailAccountId}] Created receiver state with initial UID ${currentHighestUid}`,
    );
  } else {
    console.log(
      `[IMAP][Account ${emailAccountId}] Loaded receiver state: UID ${receiverState.last_processed_uid}`,
    );
  }

  lastProcessedUid = Number(receiverState.last_processed_uid);

  async function processMailbox() {
    if (processingMailbox) {
      mailboxChangePending = true;

      console.log(
        `[IMAP][Account ${emailAccountId}] Mailbox processing already running; change marked pending`,
      );

      return;
    }

    processingMailbox = true;

    try {
      do {
        mailboxChangePending = false;

        const previousUid = lastProcessedUid;

        console.log(
          `[IMAP][Account ${emailAccountId}] Checking for messages after UID ${previousUid}`,
        );

        const newLastProcessedUid = await processNewMessages(
          client,
          mailbox,
          emailAccount,
          previousUid,
        );

        if (newLastProcessedUid > lastProcessedUid) {
          lastProcessedUid = newLastProcessedUid;
        }

        console.log(
          `[IMAP][Account ${emailAccountId}] UID state: lastProcessedUid=${lastProcessedUid}`,
        );
      } while (mailboxChangePending);
    } catch (error) {
      console.error(
        `[IMAP][Account ${emailAccountId}] Mailbox processing failed:`,
        error,
      );
    } finally {
      processingMailbox = false;
    }
  }

  await processMailbox();

  console.log(
    `[IMAP][Account ${emailAccountId}] Initial mailbox processing completed`,
  );

  console.log(`[IMAP][Account ${emailAccountId}] Entering IDLE`);

  return client;
}

/*
 * Keeps one receiver per active account, and keeps them alive.
 *
 * Receivers used to be started once, at boot, from the accounts that existed
 * then. An account added later never received replies until a restart, and a
 * dropped IMAP connection (network blip, server timeout) was logged and never
 * reopened, so replies silently stopped. This reconciles on an interval
 * instead: new or disconnected accounts are (re)started, deactivated ones
 * stopped.
 */
const RECEIVER_SYNC_MS = Number(process.env.EMAIL_RECEIVER_SYNC_MS || 60000);

const receivers = new Map();
const failing = new Set();
let syncing = false;

async function syncReceivers() {
  if (syncing) {
    return;
  }

  syncing = true;

  try {
    const emailAccounts = (await getActiveEmailAccounts()) || [];
    const activeIds = new Set(emailAccounts.map((account) => account.id));

    for (const [accountId, client] of receivers) {
      if (!activeIds.has(accountId)) {
        receivers.delete(accountId);
        console.log(`[IMAP][Account ${accountId}] Stopping: account no longer active`);
        client.logout().catch(() => client.close());
      }
    }

    for (const emailAccount of emailAccounts) {
      const current = receivers.get(emailAccount.id);

      // imapflow clears `usable` when the connection closes.
      if (current && current.usable) {
        continue;
      }

      receivers.delete(emailAccount.id);

      try {
        receivers.set(emailAccount.id, await startAccountReceiver(emailAccount));
        failing.delete(emailAccount.id);

        console.log(`[IMAP] Email account ${emailAccount.id} started successfully`);
      } catch (error) {
        // Logged once per outage, then retried quietly every sync.
        if (!failing.has(emailAccount.id)) {
          failing.add(emailAccount.id);
          console.error(`[IMAP] Failed to start email account ${emailAccount.id}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error("[IMAP] Receiver sync failed:", error.message);
  } finally {
    syncing = false;
  }
}

async function startEmailReceiver() {
  await syncReceivers();

  setInterval(syncReceivers, RECEIVER_SYNC_MS).unref();

  console.log(`[IMAP] Receiver sync every ${RECEIVER_SYNC_MS}ms`);

  return [...receivers.values()];
}

module.exports = {
  startEmailReceiver,
  startAccountReceiver,
};
