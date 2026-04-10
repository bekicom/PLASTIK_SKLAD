# Plastik Sklad API Handover

This file is for the Flutter developer.

## Base URL

```text
http://<SERVER_IP>:8071/api
```

## Auth

All protected requests must include:

```http
Authorization: Bearer <token>
Content-Type: application/json
```

Login:

```http
POST /auth/login
```

Body:

```json
{
  "login": "admin",
  "password": "1234"
}
```

Response:

```json
{
  "ok": true,
  "token": "jwt-token",
  "user": {
    "id": "userId",
    "name": "Admin",
    "phone": "998901112233",
    "login": "admin",
    "role": "ADMIN"
  }
}
```

## What Changed

- Sale can be edited after creation.
- Purchase can be edited after creation.
- Products can be archived to a separate stock area and restored later.
- During edit, stock is recalculated.
- During edit, customer debt or supplier debt is recalculated.
- Edit supports changing:
  - date
  - customer / supplier
  - products
  - discount
  - note

## Common List APIs

Get products:

```http
GET /products
```

Default list shows only active products with `qty > 0`.

Get archived products:

```http
GET /products/archive
```

Get customers:

```http
GET /customers
```

Get suppliers:

```http
GET /suppliers
```

Get sales:

```http
GET /sales
```

Query params:

- `from`
- `to`
- `customerId`
- `soldBy`
- `status`

Example:

```http
GET /sales?from=2026-04-01&to=2026-04-30&status=COMPLETED
```

Profit card detail (eye button):

```http
GET /analytics/profit-details?from=2026-01-01&to=2026-03-31&currency=ALL&limit=500
```

Optional query:

- `from`, `to`
- `currency=ALL|UZS|USD`
- `productId`
- `customerId`
- `limit` (max 1000)

Returns:

- `summary` (revenue/cost/grossProfit by currency)
- `byProduct[]` (which product gave how much profit)
- `transactions[]` (sale/return rows)

Starting balance CRUD (for Pul oqimi):

```http
POST /analytics/starting-balance
GET /analytics/starting-balance
PUT /analytics/starting-balance/:id
PATCH /analytics/starting-balance/:id
DELETE /analytics/starting-balance/:id
```

Notes:

- Front can add initial balance from input.
- Front can edit/delete old rows.
- `/analytics/overview` now uses DB starting balance automatically.

Purchase optimization (auto revaluation):

- If new purchase comes with different `buy_price` while old stock remains,
  backend auto creates revaluation record:
  - price up => `GAIN`
  - price down => `LOSS`
- Purchase create/edit response contains:
  - `inventoryRevaluationCount`
- `analytics/overview` profit includes revaluation impact.

Business analysis API:

```http
GET /analytics/business-analysis?from=2026-01-01&to=2026-03-31&currency=ALL&limit=10
```

Returns:

- top and bottom customers by profit
- top and bottom products by profit
- top and bottom suppliers by profit
- full tables for customers/products/suppliers
- overview totals (revenue/cost/profit/margin)

Buyurtmani edit (confirmdan oldin):

```http
PUT /orders/:id/edit
PATCH /orders/:id/edit
```

Rules:

- only `NEW` orders can be edited
- qty cannot exceed current stock
- totals are recalculated after edit

Get purchases:

```http
GET /purchases
```

Query params:

- `from`
- `to`
- `supplier_id`
- `status`

Example:

```http
GET /purchases?from=2026-04-01&to=2026-04-30
```

## Sale APIs

### Create sale

```http
POST /sales/create
```

Body with existing customer:

```json
{
  "saleDate": "2026-04-08T10:00:00.000Z",
  "customerId": "customerObjectId",
  "discount": 0,
  "note": "Izoh",
  "items": [
    {
      "productId": "productObjectId",
      "qty": 2,
      "sell_price": 150000
    }
  ]
}
```

Body with new customer:

```json
{
  "saleDate": "2026-04-08T10:00:00.000Z",
  "customer": {
    "name": "Ali",
    "phone": "998901112233",
    "address": "Toshkent",
    "note": ""
  },
  "items": [
    {
      "productId": "productObjectId",
      "qty": 1,
      "sell_price": 150000
    }
  ]
}
```

### Edit sale

```http
PUT /sales/:id/edit
PATCH /sales/:id/edit
```

You can send only one field or all fields.

Change date only:

```json
{
  "saleDate": "2026-04-09T12:00:00.000Z",
  "note": "Sana yangilandi",
  "editReason": "Client request"
}
```

Change customer:

```json
{
  "customerId": "newCustomerObjectId",
  "editReason": "Mijoz almashtirildi"
}
```

Change customer with new customer object:

```json
{
  "customer": {
    "name": "Vali",
    "phone": "998901112244",
    "address": "Samarqand",
    "note": ""
  },
  "editReason": "Yangi mijozga o‘tkazildi"
}
```

Change products:

```json
{
  "items": [
    {
      "productId": "productObjectId1",
      "qty": 3,
      "sell_price": 140000
    },
    {
      "productId": "productObjectId2",
      "qty": 1,
      "sell_price": 250000
    }
  ],
  "editReason": "Mahsulotlar o‘zgartirildi"
}
```

Change everything:

```json
{
  "saleDate": "2026-04-10T08:30:00.000Z",
  "customerId": "newCustomerObjectId",
  "discount": 5000,
  "note": "Yangilangan sotuv",
  "items": [
    {
      "productId": "productObjectId1",
      "qty": 2,
      "sell_price": 145000
    }
  ],
  "editReason": "To‘liq tahrir"
}
```

Sale response:

```json
{
  "ok": true,
  "message": "Sale yangilandi",
  "sale": {},
  "debt": {
    "UZS": 0,
    "USD": 0
  }
}
```

## Purchase APIs

### Create purchase

```http
POST /purchases/create
```

Body:

```json
{
  "supplier_id": "supplierObjectId",
  "batch_no": "B-1001",
  "purchase_date": "2026-04-08T09:00:00.000Z",
  "note": "Kirim izohi",
  "items": [
    {
      "name": "Plastik",
      "model": "A1",
      "color": "White",
      "category": "Raw",
      "unit": "DONA",
      "currency": "UZS",
      "qty": 10,
      "buy_price": 100000,
      "sell_price": 120000
    }
  ]
}
```

### Edit purchase

```http
PUT /purchases/:id/edit
PATCH /purchases/:id/edit
```

Change date, batch and note:

```json
{
  "purchase_date": "2026-04-09T09:30:00.000Z",
  "batch_no": "B-1002",
  "note": "Sana o‘zgardi",
  "editReason": "Supplier request"
}
```

Change supplier:

```json
{
  "supplier_id": "newSupplierObjectId",
  "editReason": "Supplier o‘zgardi"
}
```

Change products:

```json
{
  "items": [
    {
      "name": "Plastik A",
      "model": "M1",
      "color": "Blue",
      "category": "Raw",
      "unit": "DONA",
      "currency": "UZS",
      "qty": 20,
      "buy_price": 90000,
      "sell_price": 110000
    }
  ],
  "editReason": "Partiya yangilandi"
}
```

Change everything:

```json
{
  "supplier_id": "supplierObjectId",
  "purchase_date": "2026-04-10T07:00:00.000Z",
  "batch_no": "B-1003",
  "note": "Yangilangan kirim",
  "items": [
    {
      "name": "Plastik A",
      "model": "M1",
      "color": "Blue",
      "category": "Raw",
      "unit": "DONA",
      "currency": "UZS",
      "qty": 15,
      "buy_price": 95000,
      "sell_price": 115000
    }
  ],
  "editReason": "To‘liq tahrir"
}
```

Purchase response:

```json
{
  "ok": true,
  "message": "Purchase yangilandi",
  "purchase": {},
  "affectedProducts": []
}
```

## Useful Detail APIs For Testing

Customer summary:

```http
GET /customers/:id/summary
```

Customer timeline:

```http
GET /customers/:id/timeline
```

Supplier detail:

```http
GET /suppliers/:id
```

Supplier timeline:

```http
GET /suppliers/:id/timeline
```

Reconciliation counterparty list:

```http
GET /reconciliation/counterparties?type=CUSTOMER&q=&debt_status=
```

Reconciliation act sverka detail:

```http
GET /reconciliation/:type/:id?from=2025-08-01&to=2026-03-31&currency=ALL
```

`type` values:

- `CUSTOMER`
- `SUPPLIER`

Act sverka response contains:

- `summary.openingDebt`
- `summary.increaseDebt`
- `summary.decreaseDebt`
- `summary.closingDebt`
- `documents[]` with `increase`, `decrease`, `balanceAfter`, and `items`

Product detail:

```http
GET /products/:id
```

Archive product stock:

```http
POST /products/:id/archive
```

Restore archive stock:

```http
POST /products/:id/restore-archive
```

Permanent hide from active list:

```http
DELETE /products/:id
```

This keeps the record as inactive, so it will not appear in the normal product list.

Archive body examples:

Archive all available stock:

```json
{
  "reason": "Kutilgan mahsulot",
  "archiveReason": "Seasonal stock"
}
```

Archive part of stock:

```json
{
  "qty": 20,
  "reason": "Ortiqcha mahsulot",
  "archiveReason": "Temporary archive"
}
```

Restore all archived stock:

```json
{
  "reason": "Yana sotuvga qaytdi"
}
```

Restore part of archived stock:

```json
{
  "qty": 10,
  "reason": "Qisman qaytarildi"
}
```

## Flutter Test Flow

### Test sale

1. Login.
2. Get products with `GET /products`.
3. Get customers with `GET /customers`.
4. Create sale with `POST /sales/create`.
5. Check sale list with `GET /sales`.
6. Edit sale with `PUT /sales/:id/edit`.
7. Check customer debt with `GET /customers/:id/summary` or `GET /customers/:id/timeline`.
8. Check stock with `GET /products/:id` or product list.

### Test purchase

1. Login.
2. Get suppliers with `GET /suppliers`.
3. Create purchase with `POST /purchases/create`.
4. Check purchase list with `GET /purchases`.
5. Edit purchase with `PUT /purchases/:id/edit`.
6. Check supplier debt with `GET /suppliers/:id/timeline` or supplier detail.
7. Check stock with `GET /products`.

### Test archive flow

1. Take a product with active stock.
2. Call `POST /products/:id/archive`.
3. Check that product disappears from `GET /products`.
4. Check archived stock with `GET /products/archive`.
5. Restore it with `POST /products/:id/restore-archive`.
6. Check that product returns to `GET /products`.

### Test act sverka flow

1. Login.
2. Call `GET /reconciliation/counterparties?type=CUSTOMER`.
3. Select customer id and call:
   `GET /reconciliation/CUSTOMER/:id?from=2025-08-01&to=2026-03-31&currency=ALL`.
4. Check summary + document rows.
5. Repeat with supplier:
   `GET /reconciliation/SUPPLIER/:id?from=2025-08-01&to=2026-03-31&currency=ALL`.

## Rules

- If `items` are sent in edit request, old items are fully replaced.
- If `items` are not sent, old items stay unchanged.
- Archived products should not appear in the normal product list unless they still have active `qty > 0`.
- `productId`, `customerId`, `supplier_id`, `saleId`, `purchaseId` must be Mongo ObjectId strings.
- Use ISO date format when possible.
- `editReason` is optional but recommended.
