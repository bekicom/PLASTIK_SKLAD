# SMSFly OTP Integration

Marketplace login uchun OTP SMS endi `SMSFly` orqali yuboriladi.

## Ishlash oqimi

1. `POST /api/marketplace/auth/request-code`
2. Backend OTP yaratadi va challenge saqlaydi
3. SMSFly orqali raqamga SMS yuboradi
4. `POST /api/marketplace/auth/verify-code` kodi bilan tekshiradi

## Kerakli env lar

```env
SMSFLY_API_KEY=your-smsfly-key
SMSFLY_BASE_URL=https://api.smsfly.uz
SMSFLY_TIMEOUT_MS=15000
MARKETPLACE_OTP_SMS_TEMPLATE=Sizning tasdiqlash kodingiz: {code}. Kodni hech kimga bermang.
MARKETPLACE_DEBUG_OTP=false
```

## SMSFly endpointlar

- `POST https://api.smsfly.uz/check-key`
- `POST https://api.smsfly.uz/send`

## Eslatma

- Agar `SMSFLY_API_KEY` yo'q bo'lsa, backend OTP ni faqat debug rejimda qaytarishi mumkin.
- Production'da `MARKETPLACE_DEBUG_OTP=false` bo'lsin.
- O'zgartirishlardan keyin process'ni restart qiling: `pm2 restart skladplastik --update-env`
