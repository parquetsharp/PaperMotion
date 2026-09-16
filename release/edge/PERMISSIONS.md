# Permission Justifications

Use these as draft Partner Center explanations, after checking the final manifest and behavior.

| Entry | Purpose and limits |
| --- | --- |
| `sidePanel` | Show the PDF study companion in Microsoft Edge's sidebar. |
| `tabs` | Read the active tab URL/title so the persistent sidebar can identify the selected PDF before per-site fetch permission is granted. No browser history enumeration API is used. |
| `storage` | Save local engine pairing credentials, expiry, document fingerprints/IDs, and metadata; retain pending pairing and tab bindings in session storage. Access is restricted to trusted extension contexts. |
| `http://127.0.0.1/*` and `http://localhost/*` | Connect to the separately installed local PaperMotion engine for pairing and scoped study API calls. Configurable loopback ports require host patterns rather than one port. The client does not permit a remote engine address. HTTP loopback is a security/policy review item, not equivalent to TLS. |
| `file:///*` | Read the open local PDF only after the user enables Edge's file-access setting and requests import. No directory enumeration is implemented. Users can instead use the file picker. |
| Optional `https://*/*` and `http://*/*` | Request a PDF website's origin at the user's import gesture. Access is not blanket-granted at installation. Redirects/authenticated resources remain subject to browser/site policy. Public HTTP support needs review for sensitive content. |
| `externally_connectable` loopback origins | Receive the pairing result from the localhost approval page. The background listener checks the pending pairing origin, page path, extension ID, token format, and expiry. It does not accept arbitrary web-origin commands. |

`activeTab` was removed: persistent `tabs` metadata plus explicit per-site permission already covers the workflow. No `history`, `cookies`, `debugger`, `webRequest`, `nativeMessaging`, or `scripting` permission is requested.

Re-evaluate all entries when changing the architecture. Do not request new permissions for hypothetical future features. The store-assigned extension ID must be tested independently of the unpacked development ID.