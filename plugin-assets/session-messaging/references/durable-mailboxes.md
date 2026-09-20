# Optional durable mailboxes

These instructions apply only to the MCP mailbox workflow. The peer helper's ordinary-session messages and replies do not use this inbox.

Register this conversation with `session_register`, keep the private `sessionHandle` here and pass it explicitly. Each new conversation or fork registers separately. `resumeHandle` recovers only this conversation's mailbox.

Find the exact recipient through paginated `sessions_list`, send with `message_send`, and read with `inbox_read`. Acknowledge using `message_ack`; answer with `message_reply`. These mailboxes do not wake the host. Stored, offered or acknowledged does not prove that a model completed the requested work.

Handles are private bearer capabilities; never include them in messages, logs or commits. `recently-seen` means adapter contact, not a running model.

Reuse an uncertain mailbox send's `idempotencyKey` only within `retentionUntil`. Empty text with `contentDeletedAt` means retention removed the content; `NOT_FOUND` after metadata expiration is not a receipt.

The broker starts on demand. Diagnose failures with the bundled `broker.cjs doctor` and its log instead of starting another broker or deleting its state.
