# NextDNS Detailed Analytics

NextDNS Detailed Analytics is an unofficial Manifest V3 browser extension for Chrome and Microsoft Edge. It lets you choose the `limit` value used by matching analytics requests from the existing NextDNS dashboard. It is not affiliated with or endorsed by NextDNS.

The default limit is **50**. You can set any positive safe whole number in the popup. NextDNS or its dashboard may enforce its own limits, so the extension cannot guarantee that the service will return the requested number of entries.

## How it works

The extension does not ask for a NextDNS API key, profile ID, OAuth access, or separate sign-in. It does not call a NextDNS analytics API itself. The NextDNS dashboard continues to make its normal authenticated requests and choose the active account/profile.

The background service worker maintains one dynamic declarative network request (DNR) rule. It matches requests to `https://api.nextdns.io/profiles/*/analytics/*` initiated by `my.nextdns.io`, with resource types `main_frame` and `xmlhttprequest`. The rule uses a URL query transform to add or replace `limit` while retaining the matching request's destination and other query parameters. It does not inspect request or response bodies.

The selected value is stored in `chrome.storage.local`. On install and browser startup, the service worker restores the saved value and replaces the extension's stable rule ID instead of adding another rule. When you apply a setting, the extension saves it, updates the rule, and reports failures in the popup. Refresh the NextDNS dashboard after applying a change so it reloads its analytics requests.

## Privacy

- No analytics, telemetry, advertising, tracking, or external backend is included.
- The extension does not store or handle NextDNS credentials.
- The extension does not load remote JavaScript or executable code.
- The only changed requests are matching requests that the NextDNS dashboard itself makes to `api.nextdns.io`.
- Opening the dashboard happens only when you press **Open NextDNS**.

## Permissions

| Permission | Reason |
| --- | --- |
| `declarativeNetRequestWithHostAccess` | Lets the extension install a URL redirect/query-transform rule for a host it has permission to access. |
| `storage` | Saves the configured limit locally and restores it after browser restarts and extension updates. |
| `https://api.nextdns.io/*` host access | Limits request modification to the NextDNS API host used for analytics. |
| `https://my.nextdns.io/*` host access | Allows DNR to modify API requests initiated by the NextDNS dashboard; the rule further restricts matching to this initiator. No page scripts or page data are read. |

The extension does not inject code into or read `my.nextdns.io`; it has host access only so DNR can recognize the dashboard as the initiator of matching API requests. Opening the page happens only when you press the button. It does not need the `tabs` permission to create a new tab.

## Install for development

1. Download or clone this repository.
2. In Chrome, open `chrome://extensions`; in Edge, open `edge://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select this project directory.
5. Open the extension popup, set a limit if desired, and refresh the NextDNS dashboard.

To install a published release, use the relevant browser extension store once one is available. This repository currently provides the unpacked development instructions only.

## Tests

Requires Node.js with the built-in test runner. Run:

```sh
node --test
```

The tests cover limit validation, local persistence, dynamic rule replacement and restoration, failure rollback, and the query transform's intended URL behavior. These unit tests verify the generated DNR rule shape and simulate its query transformation; they do not replace a browser-level test against the Chrome or Edge DNR engine.

An optional Edge smoke test loads a temporary copy of the extension into an isolated profile and uses Edge's DNR match-outcome API to check that a dashboard-origin analytics request matches the installed rule. The test copy adds `declarativeNetRequestFeedback` for development diagnostics; the production manifest does not request it. The test performs no NextDNS API request and uses no account data. Run it on Windows with Edge installed:

```sh
npm run test:browser
```

The smoke test does not contact NextDNS or use a user's profile ID or credentials.

## Project files

- `manifest.json`: Manifest V3 permissions, popup, and service worker.
- `background.js`: restores settings and receives popup requests.
- `extension-core.js`: validation, DNR rule construction, and injectable settings controller.
- `popup.html`, `popup.css`, `popup.js`: the standalone settings popup.
- `tests/`: Node tests for validation, persistence, and rule lifecycle.

## License

MIT. See [LICENSE](LICENSE).
