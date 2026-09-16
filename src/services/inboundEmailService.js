const { query } = require("../config/database");

function normalizeMessageId(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  return value.trim();
}

function normalizeEmail(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  return value.trim().toLowerCase();
}

function parseReferences(referencesHeader) {
  if (!referencesHeader || typeof referencesHeader !== "string") {
    return [];
  }

  return referencesHeader.split(/\s+/).map(normalizeMessageId).filter(Boolean);
}

async function findConversationByMessageId(messageId) {
  if (!messageId) {
    return null;
  }

  const result = await query(
    `
      SELECT
        c.conversation_id,
        c.id AS communication_id,
        c.organization_id,
        c.lead_id,
        c.customer_id,
        c.subject,
        ed.message_id,
        ed.references_header
      FROM email_deliveries ed
      INNER JOIN communications c
        ON c.id = ed.communication_id
      WHERE ed.message_id = $1
      ORDER BY ed.id DESC
      LIMIT 1
    `,
    [messageId],
  );

  return result.rows[0] || null;
}

async function findConversationByReference(messageId) {
  if (!messageId) {
    return null;
  }

  const result = await query(
    `
      SELECT
        c.conversation_id,
        c.id AS communication_id,
        c.organization_id,
        c.lead_id,
        c.customer_id,
        c.subject,
        ed.message_id,
        ed.references_header
      FROM email_deliveries ed
      INNER JOIN communications c
        ON c.id = ed.communication_id
      WHERE
        ed.references_header IS NOT NULL
        AND ed.references_header LIKE $1
      ORDER BY ed.id DESC
      LIMIT 1
    `,
    [`%${messageId}%`],
  );

  return result.rows[0] || null;
}

async function findCommunicationByMessageId(messageId) {
  if (!messageId) {
    return null;
  }

  const result = await query(
    `
      SELECT
        c.id,
        c.conversation_id,
        c.organization_id
      FROM communications c
      INNER JOIN email_deliveries ed
        ON ed.communication_id = c.id
      WHERE ed.message_id = $1
      LIMIT 1
    `,
    [messageId],
  );

  return result.rows[0] || null;
}

async function createInboundCommunication({
  organizationId,
  conversationId,
  leadId,
  customerId,
  subject,
  body,
}) {
  const result = await query(
    `
      INSERT INTO communications (
        organization_id,
        channel,
        direction,
        lead_id,
        customer_id,
        conversation_id,
        subject,
        body,
        status,
        created_by
      )
      VALUES (
        $1,
        'email',
        'inbound',
        $2,
        $3,
        $4,
        $5,
        $6,
        'delivered',
        NULL
      )
      RETURNING *
    `,
    [
      organizationId,
      leadId || null,
      customerId || null,
      conversationId || null,
      subject || null,
      body || null,
    ],
  );

  return result.rows[0];
}

async function createInboundDelivery({
  communicationId,
  messageId,
  fromAddress,
  toAddress,
  ccAddress,
  replyTo,
  inReplyTo,
  referencesHeader,
  receivedAt,
}) {
  const result = await query(
    `
      INSERT INTO email_deliveries (
        communication_id,
        message_id,
        provider,
        recipient,
        from_address,
        to_address,
        cc_address,
        reply_to,
        in_reply_to,
        references_header,
        status,
        received_at
      )
      VALUES (
        $1,
        $2,
        'imap',
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        'delivered',
        $10
      )
      RETURNING *
    `,
    [
      communicationId,
      messageId,
      toAddress || fromAddress || "unknown",
      fromAddress || null,
      toAddress || null,
      ccAddress || null,
      replyTo || null,
      inReplyTo || null,
      referencesHeader || null,
      receivedAt || new Date(),
    ],
  );

  return result.rows[0];
}

async function updateConversation(conversationId, subject) {
  await query(
    `
      UPDATE email_conversations
      SET
        updated_at = NOW(),
        subject = COALESCE($1, subject)
      WHERE id = $2
    `,
    [subject || null, conversationId],
  );
}

async function processInboundEmail({
  messageId,
  inReplyTo,
  referencesHeader,
  fromAddress,
  toAddress,
  ccAddress,
  replyTo,
  subject,
  body,
  receivedAt,
}) {
  const normalizedMessageId = normalizeMessageId(messageId);

  const normalizedInReplyTo = normalizeMessageId(inReplyTo);

  const normalizedFromAddress = normalizeEmail(fromAddress);

  const normalizedToAddress = normalizeEmail(toAddress);

  if (!normalizedMessageId) {
    console.warn("[Inbound Email] Email has no Message-ID");
  }

  if (normalizedMessageId) {
    const existingCommunication =
      await findCommunicationByMessageId(normalizedMessageId);

    if (existingCommunication) {
      console.log(
        `[Inbound Email] Message already processed: ${normalizedMessageId}`,
      );

      return {
        duplicate: true,
        matched: true,
        communicationId: existingCommunication.id,
        conversationId: existingCommunication.conversation_id,
      };
    }
  }

  let matchedConversation = null;

  if (normalizedInReplyTo) {
    console.log(`[Inbound Email] Matching In-Reply-To: ${normalizedInReplyTo}`);

    matchedConversation =
      await findConversationByMessageId(normalizedInReplyTo);
  }

  if (!matchedConversation && normalizedInReplyTo) {
    console.log(
      `[Inbound Email] Trying References lookup for: ${normalizedInReplyTo}`,
    );

    matchedConversation =
      await findConversationByReference(normalizedInReplyTo);
  }

  if (!matchedConversation && referencesHeader) {
    const references = parseReferences(referencesHeader);

    console.log(`[Inbound Email] Searching ${references.length} References`);

    for (const reference of references.reverse()) {
      matchedConversation = await findConversationByMessageId(reference);

      if (matchedConversation) {
        console.log(
          `[Inbound Email] Conversation matched through References: ${reference}`,
        );

        break;
      }
    }
  }

  if (!matchedConversation) {
    console.log(
      `[Inbound Email] No OmniCore conversation matched for ${
        normalizedMessageId || "unknown message"
      }`,
    );

    return {
      matched: false,
      duplicate: false,
      messageId: normalizedMessageId,
      fromAddress: normalizedFromAddress,
      toAddress: normalizedToAddress,
    };
  }

  const communication = await createInboundCommunication({
    organizationId: matchedConversation.organization_id,
    conversationId: matchedConversation.conversation_id,
    leadId: matchedConversation.lead_id,
    customerId: matchedConversation.customer_id,
    subject: subject || matchedConversation.subject,
    body,
  });

  const delivery = await createInboundDelivery({
    communicationId: communication.id,
    messageId: normalizedMessageId,
    fromAddress,
    toAddress,
    ccAddress,
    replyTo,
    inReplyTo: normalizedInReplyTo,
    referencesHeader,
    receivedAt,
  });

  await updateConversation(matchedConversation.conversation_id, subject);

  console.log(
    `[Inbound Email] Stored reply: communication=${communication.id}, conversation=${matchedConversation.conversation_id}`,
  );

  return {
    matched: true,
    duplicate: false,
    conversationId: matchedConversation.conversation_id,
    communicationId: communication.id,
    deliveryId: delivery.id,
    messageId: normalizedMessageId,
  };
}

module.exports = {
  processInboundEmail,
};
