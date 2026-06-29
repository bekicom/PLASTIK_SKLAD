# BECO PLAST Backend Route Compatibility

This update keeps the backend compatible with both the current marketplace front and the older agent app path.

## Mounted prefixes

- `/api/marketplace`
- `/api/agent/app`

Both prefixes now point to the same marketplace router, so the frontend can use either one without hitting 404 on the supported TZ flows.

## Covered flows

- Auth and profile
- Product list, product detail, related products
- Cart and checkout
- Orders list and order detail
- Notifications and notification preferences
- Cashback summary
- Finance summary and statement
- Home banners, sections, promotions
- Admin dashboard, settings, system diagnostics

## Important smoke checks

- `GET /api/marketplace/version`
- `GET /api/marketplace/profile`
- `GET /api/marketplace/products`
- `GET /api/marketplace/products/:id`
- `GET /api/marketplace/products/:id/related`
- `GET /api/marketplace/cart`
- `GET /api/marketplace/orders`
- `GET /api/marketplace/notifications`
- `GET /api/marketplace/notifications/unread-count`
- `GET /api/marketplace/cashback/summary`
- `GET /api/marketplace/finance/summary`
- `GET /api/marketplace/finance/statement`

## Deploy note

After deploying these changes, restart the Node process on VPS so the new route mounts are loaded.
