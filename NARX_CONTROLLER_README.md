# Purchase Revaluation (Kirimda avto foyda/ziyon)

Bu hujjat kirim paytida avtomatik narx farqi hisobini tushuntiradi.

## 1) Maqsad

Agar mahsulotdan oldin qoldiq bor bo'lsa va yangi kirim boshqa `buy_price` bilan kelsa:

- narx farqi bo'yicha avtomatik qayta baholash qilinadi
- foyda bo'lsa `GAIN`
- ziyon bo'lsa `LOSS`
- bu qiymat analytics foyda hisobiga qo'shiladi

## 2) Qachon ishlaydi

`POST /purchases/create` va `PUT/PATCH /purchases/:id/edit` da ishlaydi.

`DELETE /purchases/:id` qilinganda shu purchasega tegishli revaluation yozuvlari ham o'chiriladi.

## 3) Formula

```text
delta_profit = (incoming_buy_price - old_avg_buy_price) * existing_qty
```

- `delta_profit > 0` => `GAIN`
- `delta_profit < 0` => `LOSS`

## 4) Purchase API javobida nima qaytadi

Create/Edit purchase javobida qo'shimcha maydon:

- `inventoryRevaluationCount` - nechta revaluation yozuvi yaratilgani

Misol:

```json
{
  "ok": true,
  "message": "Kirim muvaffaqiyatli saqlandi",
  "purchase": {},
  "products": [],
  "inventoryRevaluationCount": 1
}
```

## 5) Overview foyda ichida qaytishi

`GET /api/analytics/overview` ichida:

- `data.profit.sales` - oddiy sotuv foydasi
- `data.profit.revaluation` - revaluationdan kelgan foyda/ziyon
- `data.profit.gross` - ikkalasining yig'indisi

Misol:

```json
{
  "ok": true,
  "data": {
    "profit": {
      "sales": { "UZS": 2206820, "USD": 0 },
      "revaluation": { "UZS": 40000, "USD": 0 },
      "gross": { "UZS": 2246820, "USD": 0 },
      "net": { "UZS": 2000000, "USD": 0 }
    }
  }
}
```

## 6) Bitta aniq test scenario

1. Kirim qiling:
- Mahsulot A
- `qty=100`
- `buy_price=10000`
- `sell_price=15000`

2. Sotuv qiling:
- 80 dona soting
- qoldiq 20 dona bo'lsin

3. Yana kirim qiling (shu mahsulot):
- `qty=100`
- `buy_price=12000`
- `sell_price=16000`

4. Kutilgan natija:
- Revaluation foyda:
  - `(12000 - 10000) * 20 = +40000`
- `inventoryRevaluationCount` kamida `1` bo'ladi
- `overview`da:
  - `profit.revaluation.UZS = +40000`

5. Ziyon testi:
- Agar 2-kirim `buy_price=9000` bo'lsa:
  - `(9000 - 10000) * 20 = -20000`
  - `profit.revaluation.UZS = -20000`

## 7) Flutterda ko'rsatish tavsiyasi

- Purchase create/editdan keyin `inventoryRevaluationCount`ni snackbar yoki logda ko'rsating.
- Dashboard foyda cardida:
  - `gross` ni asosiy qiymat
  - detail ichida `sales` va `revaluation`ni alohida qatorda ko'rsating.
