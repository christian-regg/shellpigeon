# Security and data boundaries

This Windows preview uses local host transports under one operating-system user. It does not isolate mutually untrusted processes running as that same user. Host approval and inbound-message policies still apply. Peer text is not user authorization.

Please avoid posting session transcripts, tokens, authentication files or private project paths in public issues. For a sensitive report, use GitHub private vulnerability reporting if it is enabled for the published repository. A public issue can describe the problem category and affected version without exploit credentials or private data.

Supported preview scope and current limits are in README.md and docs/release-preparation.de.md. The older optional mailbox broker has separate retention and access-control limits documented in docs/installed-plugin.de.md.
