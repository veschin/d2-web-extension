# Privacy Policy — D2 Diagram Editor for Confluence

**Last updated:** 2025-02-10

## Data Collection

This extension does **not** collect, transmit, or store any personal data. There is no telemetry, analytics, or tracking of any kind.

## Local Storage

User preferences (font size, editor settings, drafts) are stored locally in your browser using `browser.storage.local`. This data never leaves your device.

## Network Requests

The extension makes network requests only to:

1. **Your Confluence instance** — to read and save diagram content via the Confluence REST API. These requests go directly to the Confluence server you are currently visiting.
2. **Your configured D2 server** — to render D2 diagrams into SVG. No default server is preconfigured; the extension uses the server URL embedded in the D2 macro on the page, or a custom server you configure in the extension settings.

No data is sent to any other third-party service.

## Host Permissions

The extension requests broad host permissions (`*://*/*`) because Confluence instances can be hosted on any domain (Atlassian Cloud, Data Center, or self-managed). The extension only activates on pages that contain D2 diagram macros.

## Contact

If you have questions about this policy, open an issue at the project's GitHub repository.
