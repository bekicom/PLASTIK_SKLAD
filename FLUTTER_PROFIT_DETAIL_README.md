# Foyda Card Detail (Flutter uchun)

Bu fayl `Foyda` carddagi ko'zcha (`detail`) oynasi uchun.

## 1) Endpoint

```http
GET /api/analytics/profit-details
```

Misol:

```http
GET /api/analytics/profit-details?from=2026-01-01&to=2026-03-31&currency=ALL&limit=500
```

## 2) Query paramlar

- `from` (ixtiyoriy) - boshlanish sanasi
- `to` (ixtiyoriy) - tugash sanasi
- `currency` (ixtiyoriy) - `ALL`, `UZS`, `USD`
- `productId` (ixtiyoriy) - faqat bitta mahsulot bo'yicha filter
- `customerId` (ixtiyoriy) - faqat bitta mijoz bo'yicha filter
- `limit` (ixtiyoriy) - nechta yozuv qaytishi (`default=500`, `max=1000`)

## 3) Nima qaytadi

Javob 3 qismdan iborat:

- `summary` - umumiy foyda/tushum/tannarx
- `byProduct[]` - qaysi tovardan qancha foyda kelgani
- `transactions[]` - sotuv va qaytarish qatorlari

## 4) transactions[] maydonlari (sodda tushuntirish)

- `date` - hodisa sanasi
- `type` - `SALE` yoki `RETURN`
- `docNo` - hujjat/invoice raqami
- `saleId` - sotuv ID
- `customerId` - mijoz ID
- `customerName` - mijoz nomi
- `productId` - mahsulot ID
- `productName` - mahsulot nomi
- `model` - model
- `category` - kategoriya
- `unit` - o'lchov birligi
- `currency` - `UZS` yoki `USD`
- `qty` - miqdor (`RETURN`da manfiy bo'lishi mumkin)
- `sellPrice` - sotuv narxi
- `buyPrice` - tannarx
- `revenue` - tushum
- `cost` - xarajat (tannarx)
- `profit` - foyda (`revenue - cost`)

## 5) byProduct[] maydonlari

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

## 6) summary maydonlari

- `UZS.revenue`
- `UZS.cost`
- `UZS.grossProfit`
- `UZS.qty`
- `UZS.rows`
- `USD.revenue`
- `USD.cost`
- `USD.grossProfit`
- `USD.qty`
- `USD.rows`
- `totalRows`
- `totalProducts`

## 7) JSON namunasi

```json
{
  "ok": true,
  "data": {
    "filters": {
      "from": "2026-01-01T00:00:00.000Z",
      "to": "2026-03-31T23:59:59.999Z",
      "currency": "ALL",
      "productId": null,
      "customerId": null,
      "limit": 500
    },
    "summary": {
      "UZS": {
        "revenue": 15000000,
        "cost": 12000000,
        "grossProfit": 3000000,
        "qty": 120,
        "rows": 60
      },
      "USD": {
        "revenue": 0,
        "cost": 0,
        "grossProfit": 0,
        "qty": 0,
        "rows": 0
      },
      "totalRows": 60,
      "totalProducts": 18
    },
    "byProduct": [
      {
        "productId": "67f...",
        "productName": "PVC Panel",
        "model": "A1",
        "category": "Panel",
        "unit": "DONA",
        "currency": "UZS",
        "soldQty": 40,
        "returnedQty": 2,
        "netQty": 38,
        "revenue": 7600000,
        "cost": 6200000,
        "grossProfit": 1400000,
        "transactions": 15
      }
    ],
    "transactions": [
      {
        "date": "2026-03-20T10:10:00.000Z",
        "type": "SALE",
        "docNo": "S-1201",
        "saleId": "680...",
        "customerId": "670...",
        "customerName": "ZERE HOME",
        "productId": "67f...",
        "productName": "PVC Panel",
        "model": "A1",
        "category": "Panel",
        "unit": "DONA",
        "currency": "UZS",
        "qty": 5,
        "sellPrice": 200000,
        "buyPrice": 160000,
        "revenue": 1000000,
        "cost": 800000,
        "profit": 200000
      }
    ]
  }
}
```

## 8) Flutterda ko'rsatish bo'yicha qisqa tavsiya

- Cardning tepasi: `summary.UZS.grossProfit`, `summary.USD.grossProfit`
- "Qaysi tovardan foyda": `byProduct[]`
- "Batafsil tarix": `transactions[]` (type bo'yicha rang berish: `SALE` yashil, `RETURN` qizil)
