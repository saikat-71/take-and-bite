# Take & Bite Website

## Included
- Bangla-English mixed customer-facing text and expanded footer information.
- `index.html` — complete responsive website with animations, menu, filters, cart and checkout form.
- `apps-script/Code.gs` — Google Apps Script code to save orders into Google Sheets.
- `assets/logo.png` — uploaded Take & Bite logo.
- `assets/menu-reference.png` — uploaded menu artwork used in the hero section.

## Google Sheets setup
1. Create a new Google Sheet.
2. Open **Extensions → Apps Script**.
3. Copy the full code from `apps-script/Code.gs`.
4. Paste it into Apps Script and save.
5. Click **Deploy → New deployment**.
6. Select **Web app**.
7. Set:
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Click Deploy and copy the Web App URL.
9. Open `index.html`.
10. Find:
   `const GOOGLE_APPS_SCRIPT_URL = "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";`
11. Replace the placeholder with your Web App URL.
12. Upload the website files to GitHub Pages, Netlify, Vercel, or any static hosting service.

## Important
- The website is free to use with GitHub Pages/Netlify/Vercel free tiers.
- Google Apps Script and Google Sheets are used for receiving orders.
- The current product prices are:
  - Vanilla cake: half ৳300, full ৳500
  - Chocolate cake: half ৳350, full ৳600
  - Orange cake: half ৳350, full ৳600
  - Vanilla tub: 500ml ৳220, 1000ml ৳420
  - Chocolate tub: 500ml ৳250, 1000ml ৳450
  - Orange tub: 500ml ৳250, 1000ml ৳450
  - Vanilla jar: ৳120
  - Chocolate jar: ৳150
  - Orange jar: ৳150

## Customization
- Change colors in the CSS variables at the top:
  `--purple: #ae8fff;`
  `--white: #ffffff;`
- Product data is inside the `products` array in `index.html`.
- Replace or add real product photos later inside each `.cake-visual` block if desired.

## New order rules
- Customers must order at least 2 days before the preferred delivery date.
- Free pickup point: City Chiklee Park Road (Sagorpara).
- Home delivery charge varies by location and is marked for confirmation.
- Custom cake designs are possible; extra design/decorations may increase the final price.
- A vanilla full cake reference image is included at `assets/vanilla-full-reference.jpg`.

- Hero menu-reference image replaced with animated captions.
- Customer rating and review section added using browser local storage.
