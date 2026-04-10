# Agent Qarz To‘lovi (Tasdiqlashli) API

## Maqsad
- Agent mijozdan pul oladi.
- Agent ilovadan so‘rov yuboradi (`PENDING`).
- Admin/Cashier tasdiqlamaguncha qarz kamaymaydi.
- Tasdiqlanganda:
  - mijoz qarzi kamayadi,
  - sale ichidagi debt FIFO bo‘yicha yopiladi,
  - `cash-in` yozuvi yaratiladi.

---

## 1) Agent so‘rov yuboradi
`POST /api/agent-debt-payments`

### Request JSON
```json
{
  "customer_id": "69d8431624809df2522e04c9",
  "amount": 1000000,
  "currency": "UZS",
  "payment_method": "CASH",
  "paymentDate": "2026-04-10",
  "note": "Mijozdan 1 mln olindi"
}
```

### Response JSON
```json
{
  "ok": true,
  "message": "Agent to‘lov so‘rovi yuborildi (PENDING)",
  "item": {
    "_id": "69d8431624809df2522e04d8",
    "agent_id": "69d8431624809df2522e04c2",
    "customer_id": "69d8431624809df2522e04c9",
    "amount": 1000000,
    "currency": "UZS",
    "payment_method": "CASH",
    "paymentDate": "2026-04-10T00:00:00.000Z",
    "note": "Mijozdan 1 mln olindi",
    "status": "PENDING",
    "cash_in_id": null
  }
}
```

---

## 2) Agent o‘z so‘rovlarini ko‘radi
`GET /api/agent-debt-payments/my?status=ALL`

`status`:
- `ALL`
- `PENDING`
- `APPROVED`
- `REJECTED`

### Response JSON
```json
{
  "ok": true,
  "total": 1,
  "items": [
    {
      "_id": "69d8431624809df2522e04d8",
      "status": "PENDING",
      "amount": 1000000,
      "currency": "UZS",
      "payment_method": "CASH"
    }
  ]
}
```

---

## 3) Admin/Cashier pending so‘rovlar ro‘yxati
`GET /api/agent-debt-payments?status=PENDING&page=1&limit=50`

### Response JSON
```json
{
  "ok": true,
  "page": 1,
  "limit": 50,
  "total": 1,
  "items": [
    {
      "_id": "69d8431624809df2522e04d8",
      "status": "PENDING",
      "amount": 1000000,
      "currency": "UZS",
      "customer_id": {
        "_id": "69d8431624809df2522e04c9",
        "name": "REQ-CUST-1775780630486",
        "balance": {
          "UZS": 3000000,
          "USD": 0
        }
      },
      "agent_id": {
        "_id": "69d8431624809df2522e04c2",
        "name": "AG-1775780630486",
        "role": "AGENT"
      }
    }
  ]
}
```

---

## 4) Admin tasdiqlaydi
`PATCH /api/agent-debt-payments/:id/approve`

### Request JSON
```json
{
  "decisionNote": "Pul qabul qilindi, tasdiqlandi"
}
```

### Response JSON
```json
{
  "ok": true,
  "message": "So‘rov tasdiqlandi, mijoz qarzidan yechildi",
  "item": {
    "_id": "69d8431624809df2522e04d8",
    "status": "APPROVED",
    "approvedBy": "69d8431624809df2522e04b9",
    "approvedAt": "2026-04-10T00:23:50.641Z",
    "decisionNote": "Pul qabul qilindi, tasdiqlandi",
    "cash_in_id": "69d8431624809df2522e04e1"
  },
  "cash_in_id": "69d8431624809df2522e04e1",
  "customer_balance": {
    "UZS": 2000000,
    "USD": 0
  }
}
```

### Tasdiqdan keyin real holat
```json
{
  "customer_balance": {
    "UZS": 2000000,
    "USD": 0
  },
  "sale_currencyTotals": {
    "UZS": {
      "paidAmount": 1000000,
      "debtAmount": 2000000
    },
    "USD": {
      "paidAmount": 0,
      "debtAmount": 0
    }
  },
  "cash_in": {
    "_id": "69d8431624809df2522e04e1",
    "target_type": "CUSTOMER",
    "amount": 1000000,
    "currency": "UZS"
  }
}
```

---

## 5) Admin rad qiladi
`PATCH /api/agent-debt-payments/:id/reject`

### Request JSON
```json
{
  "decisionNote": "Chek mos emas"
}
```

### Response JSON
```json
{
  "ok": true,
  "message": "So‘rov rad qilindi",
  "item": {
    "_id": "69d842d826ff798552a4b820",
    "status": "REJECTED",
    "decisionNote": "Chek mos emas"
  }
}
```

---

## Rollar
- `POST /api/agent-debt-payments` -> `AGENT`, `ADMIN`, `CASHIER`
- `GET /api/agent-debt-payments/my` -> `AGENT`, `ADMIN`, `CASHIER`
- `GET /api/agent-debt-payments` -> `ADMIN`, `CASHIER`
- `PATCH /api/agent-debt-payments/:id/approve` -> `ADMIN`, `CASHIER`
- `PATCH /api/agent-debt-payments/:id/reject` -> `ADMIN`, `CASHIER`

---

## Eslatma
- Barcha endpointlar uchun `Authorization: Bearer <TOKEN>` kerak.
- Tasdiqlashdan oldin mijoz qarzi o‘zgarmaydi.
- Tasdiqlanganda qarz kamayadi va `cash-in` yaratiladi.
