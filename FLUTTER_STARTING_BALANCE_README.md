# Boshlang'ich Balans (Flutter uchun tayyor README)

Bu bo'lim `Pul oqimi tafsilotlar` ichidagi `Boshlang'ich balans`ni frontdan boshqarish uchun.

## Base

```text
http://<SERVER_IP>:8071/api
```

Header:

```http
Authorization: Bearer <token>
Content-Type: application/json
```

## 1) Qo'shish (Create)

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

Valid qiymatlar:

- `currency`: `UZS` yoki `USD`
- `payment_method`: `CASH` yoki `CARD`
- `amount`: `0` dan katta son

## 2) Ro'yxat (List)

```http
GET /analytics/starting-balance
```

Filterlar:

- `from=2026-01-01`
- `to=2026-12-31`
- `currency=UZS|USD`
- `payment_method=CASH|CARD`
- `page=1`
- `limit=50`

Misol:

```http
GET /analytics/starting-balance?from=2026-01-01&to=2026-12-31&currency=UZS&page=1&limit=50
```

## 3) Tahrirlash (Edit)

```http
PUT /analytics/starting-balance/:id
PATCH /analytics/starting-balance/:id
```

Body (xohlagan maydonlarni yuborish mumkin):

```json
{
  "date": "2026-01-02",
  "currency": "UZS",
  "payment_method": "CARD",
  "amount": 5000000,
  "note": "Yangilangan yozuv"
}
```

## 4) O'chirish (Delete)

```http
DELETE /analytics/starting-balance/:id
```

## 5) List javobida nimalar qaytadi

```json
{
  "ok": true,
  "page": 1,
  "limit": 50,
  "total": 2,
  "summary": {
    "UZS": { "CASH": 112683225, "CARD": 5000000, "total": 117683225 },
    "USD": { "CASH": 0, "CARD": 0, "total": 0 }
  },
  "items": [
    {
      "_id": "680...",
      "date": "2026-01-01T00:00:00.000Z",
      "currency": "UZS",
      "payment_method": "CASH",
      "amount": 112683225,
      "note": "Boshlang'ich kassa",
      "createdAt": "2026-04-08T12:00:00.000Z",
      "updatedAt": "2026-04-08T12:00:00.000Z"
    }
  ]
}
```

## 6) Muhim eslatma

- `GET /analytics/overview` shu kiritilgan boshlang'ich balans yozuvlarini avtomatik ishlatadi.
- Ya'ni hardcode raqam yo'q, frontdan kiritilgan ma'lumot hisobga kiradi.

## 7) Tezkor test ketma-ketligi

1. `POST /analytics/starting-balance` bilan 1-2 ta yozuv qo'shing.
2. `GET /analytics/starting-balance` bilan list va summary ni tekshiring.
3. `PUT /analytics/starting-balance/:id` bilan amountni o'zgartiring.
4. `DELETE /analytics/starting-balance/:id` bilan bitta yozuvni o'chiring.
5. `GET /analytics/overview`da boshlang'ich balans o'zgarganini tekshiring.
