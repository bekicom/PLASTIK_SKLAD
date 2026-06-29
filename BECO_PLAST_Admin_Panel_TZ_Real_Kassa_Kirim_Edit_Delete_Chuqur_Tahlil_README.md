# BECO PLAST Admin Panel TZ

## Real Kassa Kirim Edit/Delete Chuqur Tahlil

Bu hujjat admin paneldagi `Kirim` bo‘limi uchun `Mijoz` va `Zavod` kirimlarining `edit/delete` amallarini to‘g‘ri ishlatish, `Real kassa` bilan moslashtirish va eski xatolarni repair qilish bo‘yicha yakuniy README hisoblanadi.

## 1. Asosiy muammo

- `Mijoz` kirimida `edit` ishlamayapti yoki saqlashda xato qaytmoqda.
- `Zavod` kirimida ham `edit` ishlamayapti.
- `delete` qilingan kirimlar `Real kassa` hisobida qolib ketmoqda.
- Pul oqimi va `Real kassa` summary bir-biriga mos emas.

## 2. Muhim prinsip

`Kirim` edit/delete amali faqat bitta joyni emas, quyidagi barcha qatlamlarni bir transaksiyada yangilashi kerak:

- customer yoki supplier balans
- payment history
- pul oqimi yozuvi
- real cash ledger
- audit log

Yarim yangilanish bo‘lmasligi shart. Masalan, customer balance o‘zgargan, lekin real cash qolgan holat qat’iyan noto‘g‘ri.

## 3. To‘g‘ri data modeli

Real kassa `source kirim`dan qo‘lda sanalmasin. Har bir pul harakati ledger yozuvi bilan yuritilsin:

- `source_type`
- `source_id`
- `source_collection`
- `direction`
- `amount`
- `currency`
- `payment_method`
- `debt_amount`
- `debt_currency`
- `exchange_rate`
- `status`
- `voided_by_transaction_id`
- `transaction_group_id`
- `idempotency_key`
- `createdBy`, `updatedBy`, `deletedBy`
- `createdAt`, `updatedAt`, `deletedAt`

### Status qoidasi

- Faqat `POSTED` yozuvlar hisoblanadi.
- `VOIDED`, `REVERSED`, `DELETED`, `CANCELED` yozuvlar summaryga kirmaydi.

## 4. Biznes qoidalar

### Delete qilingan kirim

- customer yoki supplier oldingi holatga qaytadi
- payment history qaytariladi yoki void qilinadi
- pul oqimi yozuvi void qilinadi
- real cash yozuvi void qilinadi
- takror delete bo‘lsa summa ikkinchi marta ayirilmaydi

### Edit qilingan kirim

Edit `reverse + apply` prinsipi bilan ishlashi kerak:

1. Eski kirim ta’siri bekor qilinadi
2. Yangi kirim ta’siri qayta qo‘llanadi
3. Audit log yoziladi

### Cross-valyuta

- `UZS -> UZS` va `USD -> USD`: kurs default `1`
- `UZS -> USD` yoki `USD -> UZS`: kurs majburiy
- real kassa real kelgan valyutada o‘zgaradi
- debt esa qarz valyutasida yopiladi

## 5. Backend service talabi

Mijoz va Zavod kirimlari alohida controllerlarda tarqoq logika bilan ishlamasligi kerak. Bitta umumiy service tavsiya qilinadi:

```js
incomeLedgerService.updateIncome({
  source_type,
  source_id,
  actor_id,
  request_id,
  payload
});

incomeLedgerService.deleteIncome({
  source_type,
  source_id,
  actor_id,
  request_id,
  reason
});
```

Controller faqat:

- validate qiladi
- primitive DTO yuboradi
- response qaytaradi

Service esa:

- eski yozuvni `lean()` yoki plain object qilib oladi
- Mongo transaction/session ichida ishlaydi
- reverse/apply qiladi
- audit log yozadi

## 6. Ruxsat etilgan API endpointlar

Mavjud endpoint nomlari saqlanishi mumkin. Eng muhim narsa ichki logika va natija qoidasi.

### Tavsiya qilingan endpointlar

- `PATCH /api/admin/incomes/customer/:id`
- `DELETE /api/admin/incomes/customer/:id`
- `PATCH /api/admin/incomes/factory/:id`
- `DELETE /api/admin/incomes/factory/:id`
- `GET /api/admin/real-cash/summary`
- `GET /api/admin/real-cash/diagnostics`
- `POST /api/admin/real-cash/repair-deleted-incomes`

## 7. Validation va xato kodlari

| Code | Qachon | Frontend xabari |
|---|---|---|
| `NOT_FOUND` | Kirim topilmadi | Kirim topilmadi yoki o‘chirilgan. |
| `CANNOT_EDIT_DELETED_INCOME` | Deleted kirim edit qilindi | O‘chirilgan kirimni tahrirlab bo‘lmaydi. |
| `ALREADY_DELETED` | Takror delete | Bu kirim oldin o‘chirilgan. |
| `INVALID_AMOUNT` | Summa 0 yoki manfiy | Summa noto‘g‘ri. |
| `INVALID_CURRENCY` | Valyuta noto‘g‘ri | Valyuta noto‘g‘ri tanlangan. |
| `INVALID_CROSS_CURRENCY` | Cross qoidasi buzilgan | Cross-valyuta ma’lumotlari noto‘g‘ri. |
| `NO_PERMISSION` | Role yetarli emas | Bu amal uchun ruxsat yo‘q. |
| `REAL_CASH_LINK_MISSING` | Bog‘langan kassa yozuvi yo‘q | Kassa bog‘lanishi topilmadi. |

## 8. Diagnostics va repair

Diagnostics faqat o‘qish uchun bo‘lishi kerak, summa o‘zgartirmasligi kerak.

Tekshiradigan narsalar:

- deleted source kirimlari ichida hali `POSTED` real cash yozuvlar bor-yo‘qligi
- pul oqimi va real cash summary farqi
- mijoz / zavod kirimlarida link yo‘qolgan yozuvlar

### Repair flow

`dry_run=true` majburiy bo‘lishi kerak.

Keyin:

`POST /api/admin/real-cash/repair-deleted-incomes`

Body:

```json
{
  "dry_run": true,
  "from": "2026-01-01",
  "to": "2026-12-31"
}
```

## 9. Frontend talablari

- edit modal faqat primitive DTO yuborsin
- whole populated object yuborilmasin
- save tugmasi duplicate request bermasin
- no-change save xato bermasin
- delete oldidan confirm modal bo‘lsin
- successdan keyin ro‘yxat va summary qayta yuklansin
- deleted kirimlar alohida status bilan ko‘rsatilishi mumkin, lekin default hisobga kirmasin

## 10. Security va idempotency

- edit/delete faqat `ADMIN` yoki `CASHIER`
- har bir real cash action uchun `X-Request-Id` yoki idempotency key ishlatilsin
- takror request summa ikki marta ta’sir qilmasin
- audit logda actor, action, source, old/new values, diff, request id saqlansin
- sensitive fieldlar responsega chiqmasin

## 11. Backfill / migration

1. Live bazadan backup olinadi.
2. Deleted kirimlar topiladi.
3. Ularning real cash linklari tekshiriladi.
4. Hali `POSTED` bo‘lib turgan yozuvlar `VOIDED` qilinadi yoki reversal yozuv yaratiladi.
5. Summary qayta hisoblanadi.
6. Diagnostics `critical = 0` bo‘lguncha qayta tekshiriladi.

## 12. Qabul qilish shartlari

- Mijoz kirim edit/delete xatosiz ishlaydi.
- Zavod kirim edit/delete xatosiz ishlaydi.
- `Cannot convert circular structure to BSON` xatosi yo‘qoladi.
- Delete qilingan kirimlar real kassada hisoblanmaydi.
- Pul oqimi va real kassa summarylari bir xil qoidaga bo‘ysunadi.
- Takror request summa ikki marta ta’sir qilmaydi.
- Diagnostics endpoint eski xatolarni ko‘rsatadi va repair `dry_run` bilan xavfsiz ishlaydi.

## 13. Yakuniy eslatma

Bu TZning markaziy talabi `Real kassa`ni source-of-truth sifatida to‘g‘rilashdir. Faqat frontend modalni tuzatish yetarli emas. Backend ledger, status va reversal logikasi ham to‘g‘rilanishi shart.

