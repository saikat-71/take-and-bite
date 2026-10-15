# Take & Bite — Final Setup

This version keeps the customer website and ordering flow intact while the Admin Panel uses a **GitHub Fine-grained Personal Access Token (PAT)** for browser-side GitHub access.

## Admin Panel

- Open `/admin/`.
- Enter the GitHub username, repository name, and a Fine-grained PAT.
- The token is kept only in the current browser session (`sessionStorage`).
- The dashboard checks that the token has repository write permission before opening.
- Website content, image uploads, and deletes are written directly to GitHub from the browser.
- Changes normally become visible through GitHub Pages in about 1 minute.

## GitHub PAT

Create a **Fine-grained personal access token** on GitHub.

Recommended settings:

- Repository access: **Only selected repositories**
- Repository: `take-and-bite`
- Repository permissions:
  - **Contents: Read and write**

Never paste a PAT into a source file or commit it to the repository.

## Files to configure

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

This is used for customer orders and for loading/updating order status from the admin dashboard.

## Google Sheet + Apps Script

The customer checkout sends orders to Google Sheets.

1. Create/open the Google Sheet.
2. Extensions → Apps Script.
3. Paste `apps-script/Code.gs`.
4. Run `SETUP_ONCE()` once.
5. In Apps Script → Project Settings → Script Properties, add:

```text
SPREADSHEET_ID = your_google_sheet_id
NOTIFY_EMAIL = optional_email_for_new_order_notifications
```

`GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_BRANCH` are configured automatically by `SETUP_ONCE()`.

The Apps Script validates customer cart prices by reading the public `site-data.js` from the configured repository. Admin GitHub authentication is handled by the browser PAT.

6. Deploy → New deployment → Web app.
7. Execute as: **Me**.
8. Who has access: **Anyone**.
9. Copy the `/exec` URL into `api-config.js`.

## GitHub Pages

1. Push the complete project to the `main` branch of `saikat-71/take-and-bite`.
2. GitHub → repository → Settings → Pages.
3. Source: Deploy from a branch.
4. Branch: `main`.
5. Folder: `/ (root)`.
6. Save.

Website:

```text
https://saikat-71.github.io/take-and-bite/
```

Admin:

```text
https://saikat-71.github.io/take-and-bite/admin/
```

## Customer flow

```text
Website
  → Product / Size
  → Add to Cart
  → Cart
  → Checkout
  → Google Apps Script
  → Google Sheet
```

The Apps Script validates product/variant IDs and prices against the live public catalog before recording the order.

## Admin flow

```text
/admin/
  → GitHub PAT
  → Verify repository write permission
  → Admin Dashboard
  → Edit website
  → Save changes directly to GitHub
  → GitHub Pages
```

## Security notes

- Never commit the PAT.
- Never put the PAT in `site-data.js` or `api-config.js`.
- Do not save the PAT in browser `localStorage`.
- The admin session uses `sessionStorage` only.
- If the PAT is exposed, revoke it immediately and create a new one.
