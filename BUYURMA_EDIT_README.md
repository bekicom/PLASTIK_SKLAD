# Buyurma Edit

## Endpoint

```http
PUT /api/orders/:id/edit
PATCH /api/orders/:id/edit
```

Faqat `status=NEW` bo'lgan buyurtma edit qilinadi.

## Body namunasi

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

## Qoidalar

- `qty` ombordagi mavjud miqdordan oshmasligi kerak
- bir xil `product_id` takrorlanmasligi kerak
- editdan keyin `total_uzs` va `total_usd` avtomatik qayta hisoblanadi
- keyin `POST /api/orders/:id/confirm` bilan qabul qilinadi

## Response (qisqa)

```json
{
  "ok": true,
  "message": "Zakas yangilandi",
  "order": {
    "_id": "orderId",
    "status": "NEW",
    "totals": { "UZS": 120000, "USD": 0 },
    "items": []
  }
}
```
