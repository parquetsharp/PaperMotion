# Edge Add-ons Listing Draft

Do not submit until READINESS.md and release.json are complete. Keep the listing Edge-specific and do not imply Microsoft/GitHub endorsement.

## Name

PaperMotion Study Companion

## Single purpose

Help users study a PDF they select in Microsoft Edge by connecting a sidebar to their locally installed PaperMotion learning engine.

## Short description

Study PDFs with your local PaperMotion engine: chat, flashcards, quizzes, and concepts.

## Description

PaperMotion Study Companion connects Microsoft Edge to the PaperMotion engine running on your computer. Open a text-based PDF, choose Study This PDF, and use the sidebar to ask document questions, practice flashcards, answer quizzes, and explore concepts. Saved work remains available through your local engine.

**Required before use:** a separately installed and running PaperMotion engine, Node.js 22 or newer for the source release, and access to a supported AI provider. Installing this extension alone does not install the engine, create an AI account, or provide AI credits. Your chosen provider's subscription, usage limits, costs, and organization policies apply. GitHub Copilot users need an authorized Copilot CLI installation and sign-in; signing into an editor alone does not guarantee access.

For interactive animations, formulas, plots, 3D scenes, algorithm simulators, and feedback-driven render corrections, select Open interactive viewer. These features open in the separate local web application, not directly inside Edge's built-in PDF renderer. Simulator inputs can be changed and rerun locally without another AI generation request. AI-generated content can be inaccurate; verify important results against the source.

The extension requests access to a PDF's website when you import it. Local PDFs require Edge's Allow access to file URLs setting or the file picker. Scanned/image-only, encrypted, temporary-URL, or authenticated documents may not import; a file-picker fallback is provided. The extension does not synchronize the built-in PDF viewer's selection or scroll position with the study pane.

Relevant document text and study conversations are sent to the AI provider configured in your local engine when you use AI features. The extension does not include a shared AI key. Your browser and organization may restrict installation, website access, local connections, or AI services.

Setup and companion download: [APPROVED PUBLIC COMPANION URL]
Privacy policy: [PUBLIC HTTPS PRIVACY URL]
Support: [PUBLISHER SUPPORT CONTACT]

## Listing choices

- Visibility recommendation: Hidden initially, after certification; this is not a way to skip review.
- Category suggestion: Productivity, subject to the choices shown in Partner Center.
- Search terms: PDF study; flashcards; quizzes; document chat; learning; PaperMotion.
- Logo: generated 300x300 PNG in the release assets directory.
- Optional screenshots: real extension UI with synthetic educational content, captured at 1280x800. No private documents, account identifiers, or tokens. Screenshots do not prove real AI-provider access.
- Publisher: owner must supply and verify. Repository authors are not automatically the store publisher.

## Data-use form preparation

Review the exact categories shown by Partner Center. Likely relevant categories include website content (PDF text), browsing-related information (active URL/title), user-provided content (chat/answers), and authentication information (local pairing token). Do not claim "no data accessed" merely because the engine is local. Review provider traffic and all consent/cancellation behavior against the final public privacy policy.

## Remote-code disclosure

The extension package contains bundled JavaScript/CSS/fonts/icons and does not load generated model JavaScript into its extension context. The separate localhost viewer executes model-generated visualization/simulation code. Disclose this architecture in reviewer notes and obtain a policy assessment; do not use a remote-code form answer as a substitute for reviewing the full product behavior.