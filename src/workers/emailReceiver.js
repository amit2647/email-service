const { simpleParser } = require("mailparser");
const { createImapClient } = require("../config/imap");
const { processInboundEmail } = require("../services/inboundEmailService");
const {
  getReceiverState,
  createReceiverState,
  updateReceiverState,
} = require("../services/emailReceiverStateService");

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

async function processMessage(client, uid) {
  console.log(`[IMAP] Fetching UID ${uid}`);

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
    console.warn(`[IMAP] Unable to read message UID ${uid}`);
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

  console.log("[IMAP] New email received");
  console.log(`[IMAP] UID: ${uid}`);
  console.log(`[IMAP] From: ${fromAddress}`);
  console.log(`[IMAP] To: ${toAddress}`);
  console.log(`[IMAP] Subject: ${subject}`);
  console.log(`[IMAP] Message-ID: ${messageId}`);
  console.log(`[IMAP] In-Reply-To: ${inReplyTo}`);
  console.log(`[IMAP] References: ${references}`);

  const result = await processInboundEmail({
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

  console.log("[IMAP] Processing result:", result);

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
  organizationId,
  lastProcessedUid,
) {
  const lock = await client.getMailboxLock(mailbox);

  try {
    const minimumUid = Number(lastProcessedUid) + 1;

    console.log(`[IMAP] Searching for UIDs >= ${minimumUid}`);

    const searchResult = await client.search(
      {
        uid: `${minimumUid}:*`,
      },
      {
        uid: true,
      },
    );

    if (!searchResult || searchResult.length === 0) {
      console.log("[IMAP] No new UIDs found");

      return lastProcessedUid;
    }

    const newUids = searchResult
      .filter((uid) => uid >= minimumUid)
      .sort((a, b) => a - b);

    console.log(
      `[IMAP] Found ${newUids.length} new UID(s): ${newUids.join(", ")}`,
    );

    let highestSuccessfullyProcessedUid = Number(lastProcessedUid);

    for (const uid of newUids) {
      try {
        const result = await processMessage(client, uid);

        if (result?.matched || result?.duplicate) {
          await client.messageFlagsAdd(uid, ["\\Seen"], {
            uid: true,
          });

          console.log(`[IMAP] UID ${uid} marked as Seen`);
        } else {
          console.log(
            `[IMAP] UID ${uid} was not matched to an OmniCore conversation; leaving unread`,
          );
        }

        highestSuccessfullyProcessedUid = uid;

        await updateReceiverState(
          organizationId,
          mailbox,
          highestSuccessfullyProcessedUid,
        );

        console.log(
          `[IMAP] Persisted checkpoint: UID ${highestSuccessfullyProcessedUid}`,
        );
      } catch (error) {
        console.error(`[IMAP] Failed to process UID ${uid}:`, error);

        break;
      }
    }

    return highestSuccessfullyProcessedUid;
  } finally {
    lock.release();
  }
}

async function startEmailReceiver() {
  const client = createImapClient();

  const mailbox = process.env.IMAP_MAILBOX || "INBOX";

  const organizationId = Number(process.env.EMAIL_ORGANIZATION_ID || 1);

  let lastProcessedUid = 0;
  let processingMailbox = false;
  let mailboxChangePending = false;

  client.on("error", (error) => {
    console.error("[IMAP] Client error:", error);
  });

  client.on("close", () => {
    console.warn("[IMAP] Connection closed");
  });

  await client.connect();

  await client.mailboxOpen(mailbox);

  console.log(`[IMAP] Watching mailbox: ${mailbox}`);

  let receiverState = await getReceiverState(organizationId, mailbox);

  if (!receiverState) {
    const currentHighestUid = await getHighestUid(client);

    receiverState = await createReceiverState(
      organizationId,
      mailbox,
      currentHighestUid,
    );

    console.log(
      `[IMAP] Created receiver state with initial UID ${currentHighestUid}`,
    );
  } else {
    console.log(
      `[IMAP] Loaded receiver state: UID ${receiverState.last_processed_uid}`,
    );
  }

  lastProcessedUid = Number(receiverState.last_processed_uid);

  async function processMailbox() {
    if (processingMailbox) {
      mailboxChangePending = true;

      console.log(
        "[IMAP] Mailbox processing already running; change marked pending",
      );

      return;
    }

    processingMailbox = true;

    try {
      do {
        mailboxChangePending = false;

        const previousUid = lastProcessedUid;

        console.log(`[IMAP] Checking for messages after UID ${previousUid}`);

        const newLastProcessedUid = await processNewMessages(
          client,
          mailbox,
          organizationId,
          previousUid,
        );

        if (newLastProcessedUid > lastProcessedUid) {
          lastProcessedUid = newLastProcessedUid;
        }

        console.log(`[IMAP] UID state: lastProcessedUid=${lastProcessedUid}`);
      } while (mailboxChangePending);
    } catch (error) {
      console.error("[IMAP] Mailbox processing failed:", error);
    } finally {
      processingMailbox = false;
    }
  }

  await processMailbox();

  console.log("[IMAP] Initial mailbox processing completed");

  async function watchMailbox() {
    while (true) {
      try {
        if (!client.usable) {
          console.warn("[IMAP] IMAP connection is not usable");

          return;
        }

        console.log("[IMAP] Entering IDLE");

        await client.idle();

        console.log("[IMAP] IDLE ended; checking mailbox");

        await processMailbox();
      } catch (error) {
        console.error("[IMAP] IDLE/watch error:", error);

        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  watchMailbox().catch((error) => {
    console.error("[IMAP] Mailbox watcher stopped:", error);
  });

  return client;
}

module.exports = {
  startEmailReceiver,
};
