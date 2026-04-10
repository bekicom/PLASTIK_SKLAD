# Biznes tahlili (Flutter uchun)

Bu hujjat to'liq biznes tahlili API uchun:

- eng ko'p foyda keltirgan mijozlar
- eng kam foyda keltirgan mijozlar
- eng ko'p foyda keltirgan mahsulotlar
- eng kam foyda keltirgan mahsulotlar
- eng ko'p foyda keltirgan zavodlar (supplier)
- eng kam foyda keltirgan zavodlar

## 1) Endpoint

```http
GET /api/analytics/business-analysis
```

Misol:

```http
GET /api/analytics/business-analysis?from=2026-01-01&to=2026-03-31&currency=ALL&limit=10
```

## 2) Query paramlar

- `from` (ixtiyoriy) - boshlanish sanasi
- `to` (ixtiyoriy) - tugash sanasi
- `currency` (ixtiyoriy) - `ALL`, `UZS`, `USD`
- `limit` (ixtiyoriy) - top/bottom nechta chiqsin (`1..50`)

## 3) Qanday hisoblaydi

- `SALE` foydani qo'shadi
- `RETURN` foydani kamaytiradi
- Har bir entity uchun hisoblaydi:
  - `revenue`
  - `cost`
  - `profit`
  - `qty`
  - `transactions`
  - `marginPercent`

## 4) JSON ichida nimalar qaytadi

- `ok`
- `data.filters`
- `data.overview`
- `data.rankings.customers.top[]`
- `data.rankings.customers.bottom[]`
- `data.rankings.products.top[]`
- `data.rankings.products.bottom[]`
- `data.rankings.suppliers.top[]`
- `data.rankings.suppliers.bottom[]`
- `data.tables.customers[]`
- `data.tables.products[]`
- `data.tables.suppliers[]`

## 5) Qator ichidagi maydonlar

Har bir ranking/table qatorida:

- `id`
- `name`
- customer/supplier uchun:
  - `phone`
  - `balance`
- product uchun:
  - `model`
  - `category`
  - `unit`
  - `supplierName`
- `stats.UZS`
- `stats.USD`

`stats.UZS` va `stats.USD` ichida:

- `revenue`
- `cost`
- `profit`
- `qty`
- `transactions`
- `marginPercent`

## 6) Oddiy JSON namunasi

```json
{
  "ok": true,
  "data": {
    "filters": {
      "from": "2026-01-01T00:00:00.000Z",
      "to": "2026-03-31T23:59:59.999Z",
      "currency": "ALL",
      "limit": 10
    },
    "overview": {
      "uniqueCustomers": 45,
      "uniqueProducts": 120,
      "uniqueSuppliers": 12,
      "salesCount": 350,
      "returnsCount": 15,
      "totals": {
        "UZS": {
          "revenue": 120000000,
          "cost": 98000000,
          "profit": 22000000,
          "qty": 5400,
          "transactions": 900,
          "marginPercent": 18.33
        },
        "USD": {
          "revenue": 0,
          "cost": 0,
          "profit": 0,
          "qty": 0,
          "transactions": 0,
          "marginPercent": 0
        }
      }
    },
    "rankings": {
      "customers": {
        "top": [],
        "bottom": []
      },
      "products": {
        "top": [],
        "bottom": []
      },
      "suppliers": {
        "top": [],
        "bottom": []
      }
    },
    "tables": {
      "customers": [],
      "products": [],
      "suppliers": []
    }
  }
}
```

## 7) Tezkor test

1. 2-3 ta mijozga sotuv qiling.
2. 1 ta mahsulotdan return qiling.
3. API ni chaqiring:
   `GET /api/analytics/business-analysis?from=2026-01-01&to=2026-12-31&currency=UZS&limit=5`
4. Tekshiring:
   - `customers.top` da eng foydali mijoz yuqorida
   - `products.bottom` da return bo'lgan mahsulot pastroqda
   - `suppliers.top` da eng ko'p foyda keltirgan zavod
