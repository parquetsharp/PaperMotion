# PaperMotion Study Companion Privacy Policy

**DRAFT: not approved or published.** Replace all bracketed fields, reconcile this text with the release security review, and obtain the publisher's approval before hosting it at the public HTTPS URL entered in Partner Center. Effective date: [DATE]. Publisher/data controller: [LEGAL PUBLISHER NAME]. Contact: [SUPPORT OR PRIVACY EMAIL/URL]. Website: [WEBSITE URL].

## Scope

This policy describes PaperMotion Study Companion for Microsoft Edge and its connection to the separately installed local PaperMotion engine. The extension is not an official Microsoft or GitHub product. Third-party AI providers have separate terms and privacy policies, including their own retention and usage policies.

## Information accessed and processed

- **Active tab:** the extension reads the active tab's URL and title to identify the PDF you choose to study. It requests the `tabs` permission for this purpose; it does not call the browser history API to enumerate past browsing.
- **PDF content:** after you choose Study This PDF and grant required permissions, the extension retrieves the PDF from that site, or reads a local PDF when you have enabled file access or chosen a file. Website retrieval can include the browser's existing cookies where the browser and site permit this. The extension does not expose or copy the cookies themselves to the engine.
- **Local pairing:** the extension stores the loopback engine address, its extension ID, a pairing token and expiry. The engine stores a hash of the token. Tokens are used to authenticate study API access, not as AI-provider credentials.
- **Saved study information:** the extension stores PDF fingerprints and imported-document identifiers for deduplication, plus document metadata. Temporary browser-session storage holds pending pairing information and active-tab/document associations. The engine stores source documents, extracted text, chats, cards, answers, knowledge graphs, generated visualizations, and feedback/version history.
- **AI-provider traffic:** when you chat, generate study material, evaluate progress, revise a visualization, or open a viewer that starts analysis, relevant document text and conversation/context are sent by the engine to the AI provider configured on your computer. Import alone does not start an AI request. Generated simulations can rerun locally with changed inputs without an additional AI call.
- **Optional public paper retrieval:** when you enable Public paper retrieval in the engine Settings, Source generation may send a citation title to OpenAlex to locate a referenced paper, then download its PDF from approved scholarly repositories (arXiv, NeurIPS, PMLR, ACL Anthology, or USENIX). Explicit arXiv references can skip the metadata query. These services receive the request, its title or paper identifier, and normal network metadata such as IP address. Document text, browser cookies, and provider credentials are not sent to the metadata/download services. Extracted passages from retrieved papers can subsequently be sent to your configured AI provider for Source generation.
- **Provider and operational storage:** provider CLIs may maintain their own credentials, session histories, logs and telemetry outside PaperMotion's data directory. The engine may log operational errors. The source build may retrieve Google Fonts. These are separate from extension packaging and must be considered when selecting a provider.

## Where information goes

The extension connects to your local engine at `127.0.0.1` or `localhost`. The current release uses HTTP loopback, not TLS; it is not designed as a public or shared server. Provider requests follow your selected provider's endpoint and transport configuration. The publisher does not operate a shared AI endpoint in this distribution, and no shared API credential is included.

[PUBLISHER: identify any services you actually operate, provider/data-processing relationships, international transfers and jurisdiction-specific disclosures. Do not assert a lawful basis or contractual protection that has not been established.]

## Purposes and permissions

Data is processed to import the selected document, provide its study tools, resume your saved work, display study progress, and apply requested visualization changes. Optional site permission is requested for the PDF's origin when needed. Local-file access is separately controlled by Edge. `sidePanel` displays the study UI; `storage` retains connection and document state.

[PUBLISHER: confirm any no-sale, no-advertising, no-analytics commitments against all distributed components and services before adding them as binding promises. No such publisher service is introduced by the extension implementation.]

## Your controls

- You choose which document to import and which provider to configure. Grant or revoke website and file permissions in Edge's extension settings.
- The consent checkbox currently gates PDF import. It is not a complete opt-out control for all subsequent operations on an already imported document. This gap must be resolved and this policy updated before submission.
- Disconnect removes the local connection from the extension. Revoke access on the engine pairing page invalidates that extension's token for future gateway requests. Neither action automatically cancels work already accepted by the engine or independently running in its web viewer. Stop the engine to stop local jobs; information already transmitted to an AI service cannot be recalled by the extension.
- Use Library in the local app to remove imported documents and their study folders. Removing the extension clears its extension storage but does not remove the engine's saved documents or the provider CLI's separate session history. Manage that history through the provider's supported controls.
- Simulator inputs and traces run in the browser; reloading restores the generated defaults. Saved visualization definitions and feedback are retained by the engine.
- Public paper retrieval is off by default. Disable it to prevent subsequent external reference requests; this does not cancel requests already started. Cached reference PDFs and extracted text remain as Library documents until deleted there. Existing visualization versions may retain quoted excerpts and source links after a reference document is deleted; delete those visualizations or their owning document to remove the saved excerpts. Inspecting a public-source link opens that site in your browser under its own policies.

## Retention and security

Engine documents remain locally until deleted by you. Pairing credentials expire after 30 days, but an expired token's stored record may remain until revoked or overwritten. Temporary browser-session associations are held in session storage. The extension is a single-user local companion; another process running as your operating-system user may be able to read its local data. Storage locations and configuration are described in the companion setup guide.

The simulator runs in a restricted worker with time and trace-size limits. These measures do not guarantee algorithm correctness or protection against every resource-exhaustion scenario. Other generated renderers require their own security review. Do not use confidential or third-party personal data unless you are authorized to share it with the selected provider.

## Requests, children, and changes

Contact [PRIVACY CONTACT] for publisher-held information and questions. For provider-held data, use that provider's request process. [PUBLISHER: specify applicable access, correction, deletion, complaint, child-audience, and jurisdictional rights after review.] Material policy changes will be published at [PRIVACY POLICY URL] with an updated effective date.