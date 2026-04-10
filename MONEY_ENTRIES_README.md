# Pul Kirim/Chiqim CRUD (Money Entries)

## Endpointlar

- `POST /api/money-entries` - create
- `GET /api/money-entries` - list + summary
- `GET /api/money-entries/:id` - bitta yozuv
- `PUT /api/money-entries/:id` - update
- `PATCH /api/money-entries/:id` - update
- `DELETE /api/money-entries/:id` - delete

## Create body

```json
{
  "entry_type": "INCOME",
  "amount": 4000,
  "currency": "UZS",
  "payment_method": "CASH",
  "entry_date": "2026-04-09",
  "note": "Bugun pul oldim"
}
```

`entry_type`:
- `INCOME` (pul kirdi)
- `EXPENSE` (pul chiqdi)

## List query

`GET /api/money-entries?from=2026-04-01&to=2026-04-30&currency=UZS&payment_method=CASH&entry_type=INCOME&page=1&limit=50`

## List response (qisqa)

```json
{
  "ok": true,
  "page": 1,
  "limit": 50,
  "total": 2,
  "summary": {
    "UZS": {
      "income": 5000,
      "expense": 45000,
      "net": -40000,
      "by_method": {
        "CASH": -40000,
        "CARD": 0
      }
    },
    "USD": {
      "income": 0,
      "expense": 0,
      "net": 0,
      "by_method": {
        "CASH": 0,
        "CARD": 0
      }
    }
  },
  "items": []
}
```

## Real test

Test qilindi:
- `INCOME` create: `4000`
- `EXPENSE` create: `45000`
- `INCOME` update: `5000`
- list + summary ishladi
- expense delete ishladi
