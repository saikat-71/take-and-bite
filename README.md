# Take & Bite — Final Setup

This version keeps the customer website and ordering flow unchanged, but the Admin Panel now uses a **GitHub Fine-grained Personal Access Token (PAT)** as the login credential, similar to the portfolio admin reference.

## What the admin login does

- No separate admin username/password.
- Enter a GitHub Fine-grained PAT in `/admin/`.
- The token is kept only in the current browser session (`sessionStorage`).
- The token is not written into this repository, `site-data.js`, `api-config.js`, or Google Apps Script properties.
- The dashboard verifies that the token can access the configured repository before opening the CMS.
- Content changes, image uploads, and deletes are published directly to GitHub through the GitHub Contents API.
- Orders remain connected to Google Sheets through the existing Apps Script backend.

## GitHub PAT

Create a **Fine-grained personal access token** on GitHub.

Recommended settings:

- Repository access: **Only selected repositories**
- Repository: `take-and-bite`
- Repository permissions:
  - **Contents: Read and write**

Do not use a classic token unless you understand its broader permissions. Never paste a PAT into a source file.

## Files you need to configure

### 1. `admin/config.js`

Confirm:

```js
window.TB_GITHUB_OWNER = "saikat-71";
window.TB_GITHUB_REPO = "take-and-bite";
window.TB_GITHUB_BRANCH = "main";
```

### 2. `api-config.js`

Keep your deployed Google Apps Script `/exec` URL:

```js
window.TB_API_URL = "YOUR_APPS_SCRIPT_EXEC_URL";
```

This is used for customer orders and for viewing/updating order status from the admin dashboard.

## Google Sheet + Apps Script

The customer checkout still sends orders to Google Sheets.

1. Create/open the Google Sheet.
2. Extensions → Apps Script.
3. Paste `apps-script/Code.gs`.
4. Run `SETUP_ONCE()` once.
5. In Apps Script → Project Settings → Script Properties, add:

```text
GITHUB_TOKEN = your_server_side_github_token
```

This server-side token is used only by Apps Script to read the public site catalog safely when validating customer cart prices. It is **different from the PAT entered into the browser Admin Panel**.
6. Deploy → New deployment → Web app.
7. Execute as: **Me**
8. Who has access: **Anyone**
9. Copy the `/exec` URL into `api-config.js`.

The Apps Script deployment should not contain a plain-text admin password.

## Publish the website with GitHub Pages

1. Push the complete project to the `main` branch of `saikat-71/take-and-bite`.
2. GitHub → repository → Settings → Pages.
3. Source: Deploy from a branch.
4. Branch: `main`.
5. Folder: `/ (root)`.
6. Save.
7. Wait for the Pages deployment to finish.

Your website will normally be:

```text
https://saikat-71.github.io/take-and-bite/
```

Admin:

```text
https://saikat-71.github.io/take-and-bite/admin/
```

## First admin login

1. Open `/admin/`.
2. Enter your GitHub PAT.
3. Click **Connect & Load Dashboard**.
4. The panel checks the PAT against the configured repository.
5. If it has Contents read/write permission, the dashboard opens.
6. Edit content.
7. Click **Publish Changes**.
8. GitHub Pages rebuilds the website automatically.

## Important security notes

- Never commit the PAT.
- Never put the PAT in `site-data.js`.
- Never put the PAT in `api-config.js`.
- Do not save the PAT in browser localStorage.
- The admin login keeps the PAT in `sessionStorage` only, so closing the browser tab/session removes it.
- If the PAT is ever exposed, revoke it immediately and create a new one.

## Customer flow

The normal Take & Bite flow remains:

```text
Website
  → Product / Size
  → Add to Cart
  → Cart
  → Checkout
  → Google Apps Script
  → Google Sheet
```

The Apps Script validates product/variant IDs and prices against the catalog before recording the order.

## Admin flow

```text
/admin/
  → GitHub PAT
  → Verify repository access
  → Admin Dashboard
  → Edit website
  → Publish
  → GitHub repository
  → GitHub Pages
```
