# Plastik Sklad Flutter Integration README

This README is for the Flutter developer.

## 0) Hozirgacha Qilingan Ishlar (Backend)

Quyidagilar allaqachon backendda ishlaydi:

- Dashboard sanasi to'g'rilandi:
  - reportlar `createdAt` bo'yicha emas, real sana bo'yicha ishlaydi (`saleDate`, `paymentDate`).
- Sotuv edit professional qilindi:
  - sana, mijoz, mahsulotlar, skidka, izoh o'zgartiriladi.
  - eski hisob rollback qilinib, yangisi qayta hisoblanadi.
- Kirim (purchase) edit professional qilindi:
  - sana, supplier, mahsulotlar, izoh o'zgartiriladi.
  - stock va supplier hisobi qayta hisoblanadi.
- Sale/Purchase edit audit maydonlari qo'shildi:
  - `editedAt`, `editedBy`, `editReason`, `revision`.
- Mahsulot arxiv funksiyasi qo'shildi:
  - aktiv ombordan arxivga o'tkazish (`/products/:id/archive`)
  - arxivdan qaytarish (`/products/:id/restore-archive`)
  - arxivdagi mahsulotlar alohida list (`/products/archive`)
- Mahsulot to'liq tarix endpoint qo'shildi:
  - `GET /products/:id/history`
  - kirim, sotuv, vozvrat, write-off, archive/restore hammasi qaytadi.
- Sotuv tarixida edit va vozvrat ko'rinadi:
  - sale `history` ishlaydi (`SALE_CREATED`, `SALE_EDITED`, `RETURN_CREATED`, ...).
- Mijoz timeline kuchaytirildi:
  - sotuv, edit, vozvrat, to'lov bir joyda ko'rinadi (`/customers/:id/timeline`).
- Akt sverka bo'limi qo'shildi:
  - mijoz va zavod uchun
  - period filter, currency filter bilan
  - opening/increase/decrease/closing va documentlar ro'yxati bilan.
- Boshlang'ich balans endi frontdan boshqariladi:
  - qo'shish (`create`)
  - ro'yxat (`list`)
  - tahrirlash (`edit`)
  - o'chirish (`delete`)
  - `overview` shu DB qiymatlarni avtomatik ishlatadi.
- Kirimda avtomatik qayta baholash qo'shildi:
  - yangi kirim narxi oldingi qoldiq narxidan farq qilsa, farq `foyda/ziyon`ga yoziladi
  - narx oshsa `GAIN`, tushsa `LOSS`
  - bu qiymat `analytics/overview`dagi foydaga qo'shiladi

Eslatma:

- Backend local DB bilan ishlashga o'tkazilgan (`mongodb://127.0.0.1:27017/plastik_sklad`).

## 1) Base URL

```text
http://<SERVER_IP>:8071/api
```

Local development example:

```text
http://127.0.0.1:8071/api
```

## 2) Authentication

Use JWT token on all protected endpoints.

```http
Authorization: Bearer <token>
Content-Type: application/json
```

Login endpoint:

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

Success response:

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

## 3) Important Rules

- Sale and purchase can be edited after creation.
- Edit can change:
  - date
  - customer / supplier
  - products
  - discount
  - note
- Product archive is supported.
- Archived stock does not appear in the normal product list.
- Customer timeline now includes sale create, edit, and return events.
- Sale detail/list responses now include `history`.
- Use Mongo ObjectId strings for IDs.
- Use ISO date strings when possible.

## 4) Products

### Get active products

```http
GET /products
```

This returns only active products with active stock.

### Get archived products

```http
GET /products/archive
```

### Get product detail

```http
GET /products/:id
```

### Get full product history

```http
GET /products/:id/history
```

This is the main endpoint for warehouse detail view.

It returns:

- kirim history
- sotuv history
- return / vozvrat history
- write-off history
- archive / restore history
- running stock and totals

### Archive product stock

```http
POST /products/:id/archive
```

Body examples:

Archive all active stock:

```json
{
  "reason": "Seasonal stock",
  "archiveReason": "Temporary archive"
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

### Restore archived stock

```http
POST /products/:id/restore-archive
```

Body examples:

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

### Permanent hide from active list

```http
DELETE /products/:id
```

This keeps the product record inactive, so it disappears from the active list.

## 5) Profit Card Detail (Ko'zcha)

### Endpoint

```http
GET /analytics/profit-details?from=2026-01-01&to=2026-03-31&currency=ALL&limit=500
```

Query params:

- `from` (optional)
- `to` (optional)
- `currency`: `ALL` | `UZS` | `USD`
- `productId` (optional)
- `customerId` (optional)
- `limit` (optional, default `500`, max `1000`)

This endpoint gives:

- total profit summary by currency
- product-by-product profit
- transaction rows (sale/return) for detail screen

Main response fields:

- `data.summary`
- `data.byProduct[]`
- `data.transactions[]`

`byProduct[]` fields:

- `productId`
- `productName`
- `model`
- `category`
- `unit`
- `currency`
- `soldQty`
- `returnedQty`
- `netQty`
- `revenue`
- `cost`
- `grossProfit`
- `transactions`

`transactions[]` fields:

- `date`
- `type` (`SALE` or `RETURN`)
- `docNo`
- `saleId`
- `customerId`
- `customerName`
- `productId`
- `productName`
- `currency`
- `qty`
- `sellPrice`
- `buyPrice`
- `revenue`
- `cost`
- `profit`

## 6) Boshlang'ich Balans (CRUD)
## 5.1) Business Analysis (To'liq tahlil)

Endpoint:

```http
GET /analytics/business-analysis?from=2026-01-01&to=2026-03-31&currency=ALL&limit=10
```

Query:

- `from`, `to`
- `currency`: `ALL` | `UZS` | `USD`
- `limit`: top/bottom uzunligi (1..50)

Qaytadi:

- `overview`:
  - `uniqueCustomers`
  - `uniqueProducts`
  - `uniqueSuppliers`
  - `salesCount`
  - `returnsCount`
  - `totals.UZS / totals.USD` (`revenue`, `cost`, `profit`, `qty`, `transactions`, `marginPercent`)
- `rankings`:
  - `customers.top[]`, `customers.bottom[]`
  - `products.top[]`, `products.bottom[]`
  - `suppliers.top[]`, `suppliers.bottom[]`
- `tables`:
  - `customers[]`, `products[]`, `suppliers[]` (to'liq ro'yxat)

Har bir ranking/table qatorida:

- `id`, `name`
- customer/supplierda: `phone`, `balance`
- productda: `model`, `category`, `unit`, `supplierName`
- `stats.UZS`, `stats.USD`

## 6) Boshlang'ich Balans (CRUD)

### Create

```http
POST /analytics/starting-balance
```

Body:

```json
{
  "date": "2026-01-01",
  "currency": "UZS",
  "payment_method": "CASH",
  "amount": 112683225,
  "note": "Boshlang'ich kassa"
}
```

### List

```http
GET /analytics/starting-balance?from=2026-01-01&to=2026-12-31&currency=UZS&payment_method=CASH&page=1&limit=50
```

Returns:

- `summary` (`UZS/USD` bo'yicha `CASH/CARD/total`)
- `items[]` (barcha kiritilgan boshlang'ich balans yozuvlari)

### Edit

```http
PUT /analytics/starting-balance/:id
PATCH /analytics/starting-balance/:id
```

Body (xohlagan maydonlar):

```json
{
  "date": "2026-01-02",
  "currency": "UZS",
  "payment_method": "CARD",
  "amount": 5000000,
  "note": "Yangilandi"
}
```

### Delete

```http
DELETE /analytics/starting-balance/:id
```

## 7) Sales

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

Examples:

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

## 8) Purchases

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

Examples:

Change date and batch:

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

### Purchase auto revaluation (optimal hisob-kitob)

- Agar shu mahsulotdan oldin qoldiq bo'lsa va yangi kirim boshqa `buy_price` bilan kelsa:
  - qoldiq bo'yicha narx farqi avtomatik hisoblanadi
  - `delta_profit` yozuvi yaratiladi (`GAIN` yoki `LOSS`)
- `createPurchase` javobida:
  - `inventoryRevaluationCount` maydoni qaytadi
- `editPurchase`da revaluation qayta hisoblanadi
- `deletePurchase`da shu purchasega tegishli revaluation yozuvlari ham o'chiriladi

## 9) Customers

### Get customers

```http
GET /customers
```

### Customer detail

```http
GET /customers/:id
```

### Customer summary

```http
GET /customers/:id/summary
```

### Customer timeline

```http
GET /customers/:id/timeline
```

This endpoint now shows:

- sale create events
- sale edit events
- return / vozvrat events
- payment events

## 10) Suppliers

### Get suppliers

```http
GET /suppliers
```

### Supplier detail

```http
GET /suppliers/:id
```

### Supplier timeline

```http
GET /suppliers/:id/timeline
```

## 11) Reconciliation (Akt Sverka)

### Counterparties for filter

```http
GET /reconciliation/counterparties?type=CUSTOMER&q=&debt_status=
```

Query params:

- `type`: `CUSTOMER` or `SUPPLIER`
- `q`: name/phone search
- `debt_status`: `DEBT` | `CLEAR` | `PREPAID`
- `limit`: max records

### Build act sverka report

```http
GET /reconciliation/:type/:id?from=2025-08-01&to=2026-03-31&currency=ALL
```

Path params:

- `type`: `CUSTOMER` or `SUPPLIER`
- `id`: counterparty ObjectId

Query params:

- `from`: start date
- `to`: end date
- `currency`: `ALL` | `UZS` | `USD`
- `organization`: optional UI field

Response includes:

- `summary.openingDebt`
- `summary.increaseDebt`
- `summary.decreaseDebt`
- `summary.closingDebt`
- `documents[]` rows with:
  - document type/number
  - increase/decrease by currency
  - running balance after each document
  - item lines

Simple response shape:

```json
{
  "ok": true,
  "type": "CUSTOMER",
  "counterparty": {
    "_id": "objectId",
    "name": "ZERE HOME",
    "phone": "99890....",
    "currentBalance": { "UZS": 4453100, "USD": 0 }
  },
  "summary": {
    "openingDebt": { "UZS": 673000, "USD": 0 },
    "increaseDebt": { "UZS": 39965000, "USD": 0 },
    "decreaseDebt": { "UZS": 35511900, "USD": 0 },
    "closingDebt": { "UZS": 4453100, "USD": 0 }
  },
  "documents": []
}
```

## 12) Useful Testing Flow

### Sale flow test

1. Login.
2. Call `GET /products`.
3. Call `GET /customers`.
4. Create sale with `POST /sales/create`.
5. Edit sale with `PUT /sales/:id/edit`.
6. Check customer summary with `GET /customers/:id/summary`.
7. Check product stock with `GET /products/:id`.

### Purchase flow test

1. Login.
2. Call `GET /suppliers`.
3. Create purchase with `POST /purchases/create`.
4. Edit purchase with `PUT /purchases/:id/edit`.
5. Check supplier timeline with `GET /suppliers/:id/timeline`.
6. Check product stock with `GET /products`.

### Archive flow test

1. Take a product with active stock.
2. Call `POST /products/:id/archive`.
3. Verify it is removed from `GET /products`.
4. Check it in `GET /products/archive`.
5. Restore it with `POST /products/:id/restore-archive`.
6. Verify it returns to `GET /products`.

### Act sverka test

1. Call `GET /reconciliation/counterparties?type=CUSTOMER`.
2. Pick one customer id.
3. Call `GET /reconciliation/CUSTOMER/:id?from=2025-08-01&to=2026-03-31`.
4. Verify summary values and document rows.
5. Repeat for supplier:
   `GET /reconciliation/SUPPLIER/:id?from=2025-08-01&to=2026-03-31`.

## 13) Response Shape Notes

Most endpoints return:

```json
{
  "ok": true,
  "message": "..."
}
```

List endpoints commonly return:

```json
{
  "ok": true,
  "total": 0,
  "items": []
}
```

`GET /products/:id/history` returns:

```json
{
  "ok": true,
  "product": {},
  "summary": {},
  "history": []
}
```

Example history rows:

- `PURCHASE_IN`
- `SALE_OUT`
- `RETURN_IN`
- `WRITE_OFF`
- `ARCHIVE_OUT`
- `ARCHIVE_IN`

## 14) History Response Format

Sale detail and sale list items now include `history`.

Example:

```json
{
  "type": "SALE_CREATED",
  "date": "2026-03-23T10:00:00.000Z",
  "by": "userObjectId",
  "note": "Sotuv yaratildi",
  "amountDelta": {
    "UZS": 300000,
    "USD": 0
  },
  "payload": {
    "customerId": "customerObjectId",
    "items": [
      {
        "productId": "productObjectId",
        "name": "PVC",
        "qty": 6,
        "subtotal": 300000,
        "currency": "UZS"
      }
    ],
    "totals": {
      "subtotal": 300000,
      "discount": 0,
      "grandTotal": 300000
    }
  }
}
```

Possible `type` values:

- `SALE_CREATED`
- `SALE_EDITED`
- `RETURN_CREATED`
- `CANCELED`
- `DELETED`

### Timeline response

`GET /customers/:id/timeline` now returns a merged history of:

- sale events
- sale edit events
- return / vozvrat events
- payment events

Example timeline item:

```json
{
  "type": "RETURN",
  "date": "2026-03-23T14:00:00.000Z",
  "ref": "S-12345",
  "note": "Vozvrat qilindi",
  "change": {
    "UZS": 50000,
    "USD": 0
  },
  "debtAfter": {
    "UZS": 250000,
    "USD": 0
  }
}
```

### What Flutter should show

- If 6 items were sold and 1 item was returned, show a separate return row.
- If a sale was edited on `2026-03-23`, show an edit row in timeline/history.
- If the customer was changed on edit, the old and new customer debt should both be reflected in the history.

If you want, I can also generate a Postman collection or a Flutter service file from this API set.

## 15) Flutterchiga Tezkor Tekshiruv Rejasi

1. Login qiling.
2. `GET /products` va `GET /products/archive` ni tekshiring.
3. `POST /sales/create` qiling, keyin `PUT /sales/:id/edit` qiling.
4. `POST /returns/create` qiling.
5. `GET /customers/:id/timeline` da `SALE_EDITED` va `RETURN` chiqqanini tekshiring.
6. `GET /products/:id/history` da kirim/sotuv/vozvrat/arxiv eventlarini tekshiring.
7. `GET /reconciliation/counterparties?type=CUSTOMER` ni chaqiring.
8. `GET /reconciliation/CUSTOMER/:id?from=2025-08-01&to=2026-03-31&currency=ALL` ni tekshiring.
9. Xuddi shuni supplier uchun ham tekshiring:
   `GET /reconciliation/SUPPLIER/:id?...`

## 16) Buyurtmani Edit (Qabuldan oldin qty o'zgartirish)

Endpoint:

```http
PUT /orders/:id/edit
PATCH /orders/:id/edit
```

Faqat `status=NEW` bo'lgan buyurtma tahrirlanadi.

Body:

```json
{
  "items": [
    {
      "product_id": "productObjectId",
      "qty": 8,
      "price": 15000
    }
  ],
  "note": "8 dona qabul qilindi"
}
```

Qoidalar:

- `qty` ombordagi mavjud miqdordan oshmasligi kerak
- bir xil product takrorlanmasligi kerak
- editdan keyin `total_uzs/total_usd` avtomatik qayta hisoblanadi
- keyin odatdagi `POST /orders/:id/confirm` bilan qabul qilinadi
