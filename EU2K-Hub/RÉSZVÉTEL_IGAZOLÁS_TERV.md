# Részvétel Igazolás Funkció - Implementációs Terv

---

## 📋 TEHÁT: Mit kell létrehozni a Firestore-ban

### 1. `authQRCodes` Collection
**Hova:** Új collection a Firestore-ban, neve: `authQRCodes`

**Dokumentum struktúra:**
- Dokumentum ID: `{qrId}` (32 karakteres random string)
- Mezők:
  - `qrId` (string) - Egyedi QR azonosító
  - `userId` (string) - A QR-t generáló felhasználó UID-je
  - `expiresAt` (Timestamp) - Lejárati idő (show_qr: 1-5 perc, scan_qr: lehet hosszabb pl. 1 nap)
  - `used` (boolean) - Fel lett-e már használva (alapértelmezett: false)
  - `usedAt` (Timestamp | null) - Mikor lett felhasználva
  - `usedBy` (string | null) - Ki használta fel (userId)
  - `createdAt` (Timestamp) - Létrehozás időpontja
  - `eventId` (string | null) - Opcionális esemény azonosító

**Fontos:** A QR tartalma (qrData) NEM kerül Firestore-ba! A QR payload csak a QR-kódban van: `{ qrId, ts, expiresAt }`. A Firestore a forrás of truth.

**Indexek létrehozása:**
- `qrId` (ascending, unique)
- `expiresAt` (ascending)
- `used` (ascending)
- `userId` (ascending)

---

### 2. `participations` Collection
**Hova:** Új collection a Firestore-ban, neve: `participations`

**Dokumentum struktúra:**
- Dokumentum ID: `{participationId}` (auto-generált vagy timestamp alapú)
- Mezők:
  - `userId` (string) - A résztvevő UID-je (aki igazolta magát)
  - `qrId` (string | null) - Ha QR-kóddal igazolt, akkor a QR ID (show_qr esetén a résztvevő QR-ja)
  - `authMethod` (string | null) - Ha kóddal igazolt, akkor "code"
  - `codeUsed` (boolean | null) - Ha kóddal igazolt, akkor true (nyers kód NEM kerül mentésre!)
  - `method` (string) - "scan_qr" | "show_qr" | "code"
  - `scanQR` (object | null) - Ha method == "scan_qr", akkor a beolvasott QR adatai:
    - `qrId` (string) - A beolvasott QR ID
    - `scannedBy` (string) - Aki beolvasta (context.auth.uid)
    - `qrEventId` (string | null) - Az esemény azonosítója (ha van)
    - `scannedAt` (Timestamp) - Beolvasás időpontja
  - `confirmedAt` (Timestamp) - Igazolás időpontja
  - `eventId` (string | null) - Opcionális esemény azonosító
  - `verifiedBy` (string | null) - Opcionális: ki igazolta (staff userId) - show_qr esetén kitöltve
  - `createdAt` (Timestamp) - Létrehozás időpontja

**Működés különböző módszereknél:**

**scan_qr módszer:**
- A felhasználó beolvassa az esemény QR-kódját a saját telefonjával
- `userId` = aki beolvasta (context.auth.uid)
- `qrId` = null (scan_qr esetén a scanQR objektumban van)
- `authCode` = null
- `method` = "scan_qr"
- `scanQR` = {
    - `qrId` = a beolvasott QR ID
    - `scannedBy` = aki beolvasta (context.auth.uid)
    - `qrOwnerId` = aki generálta a QR-t (az authQRCodes dokumentum userId mezője)
    - `scannedAt` = serverTimestamp()
  }
- `verifiedBy` = null

**show_qr módszer:**
- A felhasználó megmutatja a saját QR-kódját egy staff olvasónak
- A staff beolvassa a QR-t (ugyanaz a scanAuthQR function hívódik, de method = "show_qr")
- `userId` = a résztvevő (aki megmutatta a QR-t) - a QR dokumentum userId mezőjéből jön (NEM context.auth.uid!)
- `qrId` = a beolvasott QR ID
- `authCode` = null
- `method` = "show_qr"
- `verifiedBy` = a staff userId aki beolvasta (context.auth.uid)

**code módszer:**
- A résztvevő generálja a kódot a saját kliensén (getUserAuthCode)
- A kódot egy MÁSIK kliensen kell beírni (pl. staff beírja a résztvevő kódját egy beviteli pontnál)
- `userId` = a résztvevő (aki generálta a kódot, targetUserId)
- `qrId` = null
- `authMethod` = "code"
- `codeUsed` = true
- `method` = "code"
- `verifiedBy` = aki beírta a kódot (pl. staff userId, context.auth.uid) - opcionális
- **Fontos:** A nyers kód (pl. "103996") SOHA ne kerüljön a participations dokumentumba!

**Indexek létrehozása:**
- `userId` (ascending)
- `confirmedAt` (descending)
- `eventId` (ascending)
- `method` (ascending)
- `scanQR.qrId` (ascending) - scan_qr módszer QR-kódjainak kereséséhez

---

### 3. `userAuthCodes` Collection
**Hova:** Új collection a Firestore-ban, neve: `userAuthCodes`

**Dokumentum struktúra:**
- Dokumentum ID: `{userId}` (a felhasználó UID-je)
- Mezők:
  - `userId` (string) - Felhasználó UID-je
  - `codeHash` (string) - A 6 számjegyű kód bcrypt hash-e (pl. "$2b$10$5qQq3H2e6Z9yWkJ7dC9o6O4s3y1x2pF4R8l0oV2A6GmYtqkZpN0Se")
  - `expiresAt` (Timestamp) - Lejárati idő (max 5 perc múlva)
  - `used` (boolean) - Fel lett-e már használva (alapértelmezett: false)
  - `createdAt` (Timestamp) - Létrehozás időpontja
  - `usedAt` (Timestamp | null) - Mikor lett felhasználva

**Fontos:** 
- A nyers kódot SOHA ne mentjük Firestore-ba, csak a hash-t!
- A hash nem visszafejthető, nem ellopható DB szivárgásnál
- A kód lejárati ideje max 5 perc, és egyszer használható

**Indexek létrehozása:**
- `userId` (ascending, unique)
- `expiresAt` (ascending)
- `used` (ascending)

---

### 4. `rateLimits` Collection
**Hova:** Új collection a Firestore-ban, neve: `rateLimits`

**Dokumentum struktúra:**
- Dokumentum ID: `{userId}` (a felhasználó UID-je)
- Mezők:
  - `lastRequestTime` (Timestamp) - Utolsó kérés időpontja (globális rate limithez)
  - `requestTimes` (array of Timestamp) - Kérés időpontok (globális rate limithez)
  - `lastFunction` (string) - Utolsó meghívott function neve
  - `attempts` (number) - Hibás próbálkozások száma (confirmCode-hoz, alapértelmezett: 0)
  - `windowStart` (Timestamp | null) - Az időablak kezdete (confirmCode-hoz, 5 perc)
  - `lockedUntil` (Timestamp | null) - Tiltás vége (confirmCode-hoz, 10 perc lockout)

**Indexek létrehozása:**
- `userId` (ascending, unique)
- `lockedUntil` (ascending)

**Fontos:** 
- Ez a collection MINDEN function-höz használatos (globális failsafe)
- Globális rate limit: max 30 request/perc, minimum 100ms időköz, burst protection (3 gyors kérés)
- confirmCode-hoz extra strict: 5 hibás próbálkozás / 5 perc, 10 perc lockout, 10 request/perc

---

### 5. Firestore Security Rules
**Hova:** Firebase Console → Firestore Database → Rules

**Szabályok:**
```javascript
// authQRCodes collection - CSAK Cloud Functions olvashatja/írhatja
match /authQRCodes/{qrId} {
  allow read: if false; // Only Cloud Functions can read
  allow write: if false; // Only Cloud Functions can write
}

// participations collection
match /participations/{participationId} {
  allow read: if request.auth != null && request.auth.uid == resource.data.userId;
  allow write: if false; // Only Cloud Functions can write
}

// userAuthCodes collection - CSAK Cloud Functions olvashatja/írhatja
match /userAuthCodes/{userId} {
  allow read: if false; // Only Cloud Functions can read
  allow write: if false; // Only Cloud Functions can write
}

// rateLimits collection - CSAK Cloud Functions olvashatja/írhatja
match /rateLimits/{userId} {
  allow read: if false; // Only Cloud Functions can read
  allow write: if false; // Only Cloud Functions can write
}
```

---

## 🔧 BACKEND - Cloud Functions (részletes leírás)

### 1. `scanAuthQR` Function
**Hely:** `functions/default/index.js` fájlba kell hozzáadni

**Funkció leírása:**
- Ellenőrzi hogy a felhasználó be van-e jelentkezve (context.auth kötelező)
- A bemenet: { qrData: string, method?: string } - a method opcionális, alapértelmezett "scan_qr"
- A qrData string lehet JSON string vagy URL
- Ha JSON string, akkor parse-olni kell
- A parse-olt adatból kinyerni a qrId mezőt
- Firestore-ban lekérni az authQRCodes/{qrId} dokumentumot (csak egyet, nem query!)
- Validálni kell: létezik-e a QR, nem járt-e le (expiresAt > now), nem lett-e már felhasználva (used == false)
- Ha minden OK: a QR dokumentumot frissíteni (used = true, usedAt = serverTimestamp(), usedBy = context.auth.uid)
- A QR dokumentumból kinyerni a userId mezőt (ez a QR-t generáló felhasználó)
- Létrehozni egy új dokumentumot a participations collection-ben:
  - userId = ha method == "scan_qr", akkor context.auth.uid (aki beolvasta), ha method == "show_qr", akkor QR dokumentum userId mezője (a résztvevő)
  - qrId = ha method == "show_qr", akkor qrId, egyébként null
  - authCode = null (QR módszernél nincs kód)
  - method = method paraméter vagy "scan_qr" (alapértelmezett)
  - scanQR = ha method == "scan_qr", akkor { qrId: qrId, scannedBy: context.auth.uid, qrEventId: QR dokumentum eventId mezője (ha van), scannedAt: serverTimestamp() }, egyébként null
  - confirmedAt = serverTimestamp()
  - verifiedBy = ha method == "show_qr", akkor context.auth.uid (staff aki beolvasta), egyébként null
  - createdAt = serverTimestamp()
- Visszaadni: { success: true/false, message: string }

**Participations dokumentum példa scan_qr esetén:**
```
{
  userId: "user123",           // A résztvevő (aki beolvasta az esemény QR-ját)
  qrId: null,                   // scan_qr esetén null, mert a scanQR objektumban van
  authCode: null,               // QR módszernél nincs
  method: "scan_qr",            // Módszer
  scanQR: {                     // scan_qr specifikus adatok
    qrId: "xyz789",             // A beolvasott QR ID (az esemény QR-ja)
    scannedBy: "user123",        // Aki beolvasta
    qrEventId: "event123",       // Az esemény azonosítója (ha van)
    scannedAt: Timestamp         // Beolvasás időpontja
  },
  confirmedAt: Timestamp,      // Igazolás időpontja
  eventId: null,                // Opcionális
  verifiedBy: null,             // scan_qr esetén null
  createdAt: Timestamp
}
```

**Participations dokumentum példa show_qr esetén:**
```
{
  userId: "user456",           // A résztvevő (akinek a QR-ja van)
  qrId: "xyz789",              // A beolvasott QR ID (a résztvevő QR-ja)
  authCode: null,              // QR módszernél nincs
  method: "show_qr",           // Módszer
  confirmedAt: Timestamp,      // Igazolás időpontja
  eventId: null,               // Opcionális
  verifiedBy: "staff123",      // Staff userId aki beolvasta
  createdAt: Timestamp
}
```

**Hibakezelés:**
- Ha nincs bejelentkezve: HttpsError unauthenticated
- Ha QR nem létezik: success: false, message: "QR-kód nem található"
- Ha QR lejárt: success: false, message: "QR-kód lejárt"
- Ha QR már felhasználva: success: false, message: "QR-kód már felhasználva"
- Egyéb hibák: HttpsError internal

---

### 2. `getUserAuthQRCode` Function
**Hely:** `functions/default/index.js` fájlba kell hozzáadni

**Funkció leírása:**
- Ellenőrzi hogy a felhasználó be van-e jelentkezve (context.auth kötelező)
- Generál egy 32 karakteres random token-t (qrId) - crypto.randomBytes használata
- Létrehoz egy payload objektumot: { qrId: qrId, ts: Date.now(), expiresAt: Date.now() + 5 perc } - NEM tartalmaz userId-t vagy más érzékeny adatot!
- A payload-ot JSON stringgé alakítja
- Létrehoz egy dokumentumot az authQRCodes collection-ben: qrId = dokumentum ID, userId = context.auth.uid, expiresAt = 5 perc múlva, used = false, createdAt = serverTimestamp(), eventId = null (opcionális)
- **Fontos:** A qrData NEM kerül Firestore-ba, csak a QR payload-ban!
- Meghívja a QR Code Monkey API-t fetch-fel timeout-tal:
  ```javascript
  const res = await fetch("https://api.qrcode-monkey.com/qr/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: JSON.stringify(payload),
      size: 300,
      config: {
        body: "square",
        eye: "frame0",
        logo: ""
      }
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    throw new HttpsError("internal", "QR generálás sikertelen");
  }

  const qrBase64 = await res.text();
  return { qrCode: qrBase64 };
  ```
- **API hardening:** timeout 10 másodperc, retry nélkül. Hibánál HttpsError internal
- A válasz base64 encoded kép lesz (data:image/png;base64,... formátum)
- **Cache-elés:** A generált QR képet lehet cache-elni 30-60 másodpercig memory-ben (opcionális)
- **Minden popup megnyitáskor új QR generálódik** (rövid életű, max 5 perc)

**Hibakezelés:**
- Ha nincs bejelentkezve: HttpsError unauthenticated
- Ha QR Code Monkey API hívás sikertelen: HttpsError internal
- Egyéb hibák: HttpsError internal

---

### 3. `getUserAuthCode` Function
**Hely:** `functions/default/index.js` fájlba kell hozzáadni

**Funkció leírása:**
- Ellenőrzi hogy a felhasználó be van-e jelentkezve (context.auth kötelező)
- **Minden megnyitáskor új kódot generál** (nincs cache, mindig friss)
- Új kód generálása: 6 számjegyű random szám (100000-999999 között)
- A generált kódot bcrypt-tel hash-eli: `await bcrypt.hash(code, 10)` (bcryptjs library)
- Létrehozza/frissíti a userAuthCodes/{userId} dokumentumot: codeHash = hash, expiresAt = 5 perc múlva, used = false, createdAt = serverTimestamp(), usedAt = null
- Visszaadja: { code: "123456" } - CSAK a nyers kódot, soha a hash-t!

**Fontos:** 
- A nyers kódot SOHA ne mentjük Firestore-ba, csak a hash-t
- A nyers kódot csak egyszer küldi vissza a kliensnek megjelenítésre
- A kód lejárati ideje max 5 perc, és egyszer használható
- A kliens soha nem látja a hash-t

---

### 4. `confirmCode` Function
**Hely:** `functions/default/index.js` fájlba kell hozzáadni

**Funkció leírása:**
- Ellenőrzi hogy a felhasználó be van-e jelentkezve (context.auth kötelező)
- Bemenet: { code: string, targetUserId: string } - a beírt 6 számjegyű kód ÉS a célfelhasználó UID-je
- **Fontos:** 
  - NE query-eld végig az összes kódot! Csak egy konkrét dokumentumot olvas!
  - A kód egy helyen generálódik (résztvevő kliens), de egy MÁSIK kliensen kell beírni (pl. staff beírja a résztvevő kódját)
  - A targetUserId az, akinek a kódját beírják (a résztvevő, aki generálta)
- Firestore-ban lekéri: `userAuthCodes/{targetUserId}` dokumentumot (csak egyet!)
- Ellenőrzi: létezik-e a dokumentum?
- Ha létezik: kinyeri a codeHash, expiresAt, used mezőket
- Ellenőrzi: used == false? expiresAt > now()?
- Ha minden OK: bcrypt.compare(beírtKód, codeHash) - csak egy összehasonlítás!
- Ha bcrypt.compare true-t ad vissza:
  - A dokumentumot frissíteni (used = true, usedAt = serverTimestamp())
  - Létrehozni egy új dokumentumot a participations collection-ben:
    - userId = targetUserId (aki a kódot generálta, a résztvevő)
    - qrId = null
    - authMethod = "code"
    - codeUsed = true
    - method = "code"
    - confirmedAt = serverTimestamp()
    - createdAt = serverTimestamp()
    - **Fontos:** A nyers kód (pl. "103996") SOHA ne kerüljön a participations dokumentumba!
  - Visszaadni: { success: true, message: "Kód sikeresen megerősítve" }
- Ha bcrypt.compare false: HttpsError permission-denied, "Hibás kód"

**Hibakezelés:**
- Ha nincs bejelentkezve: HttpsError unauthenticated
- Ha dokumentum nem létezik: HttpsError not-found, "Nincs aktív kód"
- Ha kód lejárt: HttpsError deadline-exceeded, "Lejárt kód"
- Ha kód már felhasználva: HttpsError failed-precondition, "A kód már fel lett használva"
- Ha bcrypt.compare false: HttpsError permission-denied, "Hibás kód"
- Egyéb hibák: HttpsError internal

**Participations dokumentum példa code módszer esetén:**
```
{
  userId: "abc123",           // A résztvevő (aki a kódot generálta)
  qrId: null,                  // Kód módszernél nincs QR
  authMethod: "code",          // Kód módszer jelző
  codeUsed: true,              // Kód felhasználva
  method: "code",              // Módszer
  confirmedAt: Timestamp,      // Igazolás időpontja
  eventId: null,               // Opcionális
  verifiedBy: "staff456",      // Aki beírta a kódot (pl. staff userId)
  createdAt: Timestamp
}
```

**Fontos:** 
- A nyers kód (pl. "103996") SOHA ne kerüljön a participations dokumentumba! Csak az authMethod és codeUsed mezők.
- A kód egy helyen generálódik (résztvevő kliens), de egy másik kliensen kell beírni (staff/beviteli pont)

**Hibakezelés:**
- Ha nincs bejelentkezve: HttpsError unauthenticated
- Ha 10 próbálkozás után sem sikerült egyedi kódot generálni: HttpsError internal
- Egyéb hibák: HttpsError internal

---

## 💻 FRONTEND - Implementáció (részletes leírás)

### 1. `handleScanAuthQRCodeDetected` Frissítése
**Hely:** `qr-code.html` fájl, 1986-2000. sor körül

**Mit kell csinálni:**
- A jelenlegi TODO kommentet és alert-et lecserélni
- A scanning és kamera leállítása marad
- DOM elemek lekérése: scanAuthQrScanner, scanAuthSuccessState, scanAuthFailedState
- Scanner elrejtése, success és failed state-ek elrejtése (loading state)
- Try-catch blokkban meghívni a scanAuthQR Cloud Function-t: window.createHttpsCallable('scanAuthQR'), paraméter: { qrData: qrData, method: "scan_qr" }
- Ha result.data.success == true: successState megjelenítése, console log, 2 másodperc után closeScanAuthPopup() hívása
- Ha result.data.success == false: failedState megjelenítése, scanner újra megjelenítése (retry), alert hibaüzenettel
- Catch blokkban: failedState megjelenítése, scanner újra megjelenítése, alert hibaüzenettel

**Megjegyzés:** A method paraméter "scan_qr", mert ez a scan auth popup-ban történik, ahol a felhasználó beolvassa az esemény QR-kódját.

---

### 2. `openShowQrPopup` Frissítése
**Hely:** `qr-code.html` fájl, 2203. sor körül (a TODO komment után)

**Mit kell csinálni:**
- A TODO kommentet lecserélni
- DOM elemek lekérése: showQrCodeImage, showQrSuccessState, showQrFailedState
- showQrCodeImage opacity beállítása 0.5-re (loading state)
- Try-catch blokkban meghívni a getUserAuthQRCode Cloud Function-t: window.createHttpsCallable('getUserAuthQRCode'), paraméter: {}
- Ha result.data.qrCode létezik: showQrCodeImage.src = result.data.qrCode, opacity = 1, success és failed state-ek elrejtése
- Ha nincs qrCode: throw new Error
- Catch blokkban: showQrFailedState megjelenítése, showQrCodeImage elrejtése, alert hibaüzenettel

---

### 3. `openCodeEntryPopup` Frissítése
**Hely:** `qr-code.html` fájl, 2308. sor körül (a TODO komment helyett)

**Mit kell csinálni:**
- A TODO kommentet és a teszt kód logikát lecserélni
- DOM elemek lekérése: codeEntryDigits, codeEntrySuccessState, codeEntryFailedState, codeEntryContainer
- codeEntryDigits opacity beállítása 0.5-re (loading state)
- Try-catch blokkban meghívni a getUserAuthCode Cloud Function-t: window.createHttpsCallable('getUserAuthCode'), paraméter: {}
- Ha result.data.code létezik és 6 karakter hosszú: codeEntryDigits.innerHTML ürítése, 6 darab span.code-digit elem létrehozása minden számjegyhez, opacity = 1, success és failed state-ek elrejtése
- Ha nincs vagy nem 6 karakter: throw new Error
- Catch blokkban: codeEntryFailedState megjelenítése, codeEntryContainer elrejtése, alert hibaüzenettel

**Fontos:** A kód csak megjelenítésre van, soha ne mentse el sehova a frontend-en!

---

### 4. Kód beírás kezelése (új funkció szükséges)
**Hely:** `qr-code.html` fájl - új funkció hozzáadása (vagy külön staff/beviteli felület)

**Mit kell csinálni:**
- Létrehozni egy új funkciót: `confirmCodeEntry(code, targetUserId)` vagy hasonló név
- A funkció meghívja a confirmCode Cloud Function-t: window.createHttpsCallable('confirmCode'), paraméter: { code: code, targetUserId: targetUserId }
- **Fontos:** 
  - A targetUserId kötelező paraméter! (aki a kódot generálta, a résztvevő)
  - Ez egy MÁSIK kliensen fut (pl. staff beírja a résztvevő kódját)
  - A résztvevő generálja a kódot a saját kliensén, a staff beírja egy másik kliensen
- Ha result.data.success == true: success state megjelenítése, console log
- Ha HttpsError: failed state megjelenítése, alert hibaüzenettel (error.message)
- Catch blokkban: failed state megjelenítése, alert hibaüzenettel

**Megjegyzés:** 
- Ez a funkció akkor hívódik meg, amikor valaki (pl. staff) beírja a kódot egy beviteli mezőbe
- A kód egy helyen generálódik (résztvevő kliens), de egy másik kliensen kell beírni (staff/beviteli pont)
- Ez a UI rész még nincs implementálva, de a backend készen áll

---

## 🔒 Biztonsági Megfontolások

### Globális Rate Limiting (Failsafe - MINDEN function-höz)
- **Minimum időköz:** 100ms kérések között (max 10 req/sec)
- **Burst protection:** 3 gyors kérés engedélyezett, utána szigorúbb
- **Max kérések/perc:** 30 request/perc/felhasználó (globális)
- **Cél:** Megakadályozza a spammelést, DoS-t, túl sok Firestore read/write-ot, véletlen UI loop bugokat

### confirmCode Rate Limiting (Extra Strict)
- **Hibás próbálkozások:** max 5 / 5 perc
- **Lockout:** 10 perc tiltás 5 hibás próbálkozás után
- **Rate limit:** 10 request/perc (szigorúbb, mint a globális)
- **Cél:** Brute force védelem a kód próbálgatás ellen

### QR-kód Validáció
- QR tartalma ne csak userId legyen, hanem qrId (random token) is
- Minden QR-kódnak legyen expiresAt mezője
- used flag ellenőrzése kötelező (egyszer használható)

### Backend Validáció
- Minden function context.auth ellenőrzést végez
- userId soha ne a frontendről jöjjön, mindig context.auth.uid
- **Minden function elején globális rate limiting ellenőrzés**

### QR-kód Generálás
- qrId legyen 32 karakteres random string (crypto.randomBytes)
- QR tartalmában legyen ts (timestamp) és expiresAt
- Opcionális: QR tartalmát aláírhatjuk HMAC-cel extra biztonságért

### Kód Hash-elés
- **A 6 számjegyű kódot kizárólag Cloud Function generálja**
- A nyers kódot SOHA ne mentjük Firestore-ba, csak a hash-t
- bcryptjs library használata: `await bcrypt.hash(code, 10)` generáláskor, `await bcrypt.compare(code, codeHash)` ellenőrzéskor
- A nyers kódot csak egyszer küldi vissza a kliensnek megjelenítésre (getUserAuthCode válaszában)
- A confirmCode function-ben bcrypt.compare-tel összehasonlítjuk a beírt kódot a hash-tel
- **A kliens soha nem látja a hash-t**
- **SOHA ne engedjük, hogy a kliens döntse el a sikert - mindig a backend validál**
- **Hash-t NEM lehet dekódolni** - a szerver (Cloud Function) hashel és ellenőriz, a kliens soha

---

## 🔁 Teljes Flow - Kód Generálás és Ellenőrzés

### 1️⃣ Kód Generálása (getUserAuthCode Cloud Function)

**Frontend hívás:**
```javascript
getUserAuthCode({})
```

**Backend műveletek:**
1. Ellenőrzi: be van-e jelentkezve
2. Generál: 6 számjegyű random kód (pl. "103996")
3. Hash-eli: `await bcrypt.hash("103996", 10)` → "$2b$10$5qQq3H2e6Z9yWkJ7dC9o6O4s3y1x2pF4R8l0oV2A6GmYtqkZpN0Se"
4. Firestore mentés:
   ```
   userAuthCodes/{userId}
   {
     codeHash: "$2b$10$5qQq3H2e6Z9yWkJ7dC9o6O4s3y1x2pF4R8l0oV2A6GmYtqkZpN0Se",
     userId: "abc",
     expiresAt: Timestamp (5 perc múlva),
     used: false,
     createdAt: Timestamp,
     usedAt: null
   }
   ```
5. Visszaadja: `{ code: "103996" }` - CSAK a nyers kódot, soha a hash-t!

**Frontend megjelenítés:**
- A kapott nyers kódot jeleníti meg a felhasználónak
- SOHA ne menti el sehova a frontend-en

---

### 2️⃣ Kód Beírása (confirmCode Cloud Function)

**Frontend hívás:**
```javascript
confirmCode({ code: "103996" })
```

**Backend műveletek:**
1. Ellenőrzi: be van-e jelentkezve
2. Bemenet: { code: "103996", targetUserId: "abc123" }
3. **Fontos:** 
   - NE query-eld végig az összes kódot! Csak egy dokumentumot olvas!
   - A kód egy helyen generálódik (résztvevő kliens), de egy másik kliensen kell beírni (pl. staff)
4. Firestore lekérés: `userAuthCodes/{targetUserId}` dokumentum (csak egyet!)
5. Ellenőrzi: létezik-e? used == false? expiresAt > now()?
6. Ha minden OK: `await bcrypt.compare("103996", dokumentum.codeHash)` - csak egy összehasonlítás!
7. Ha bcrypt.compare true:
   - Frissíti: used = true, usedAt = serverTimestamp()
   - Létrehozza a participation-t:
     ```
     participations/{participationId}
     {
       userId: "abc123",        // A résztvevő (aki generálta a kódot)
       qrId: null,
       authMethod: "code",
       codeUsed: true,
       method: "code",
       confirmedAt: Timestamp,
       verifiedBy: "staff456",  // Aki beírta a kódot (context.auth.uid)
       createdAt: Timestamp
     }
     ```
     **Fontos:** A nyers kód (pl. "103996") SOHA ne kerüljön a participations dokumentumba!
   - Visszaadja: `{ success: true, message: "Kód sikeresen megerősítve" }`
8. Ha bcrypt.compare false: HttpsError permission-denied, "Hibás kód"

---

## ❌ Amit semmiképp ne csinálj

- 🚫 Ne legyen Firestore read a kódokra (kliens oldalról)
- 🚫 Ne legyen kliens oldali összehasonlítás
- 🚫 Ne küldj hash-t a kliensnek
- 🚫 Ne engedd, hogy a kliens döntse el a sikert
- 🚫 Ne mentsd el a nyers kódot Firestore-ba (csak a hash-t!)
- 🚫 Ne használj bcrypt.hashSync-t az ellenőrzésnél (bcrypt.compare kell!)
- 🚫 Ne query-eld végig az összes user kódját (confirmCode csak egy userId dokumentumot olvas!)
- 🚫 Ne tárold a nyers kódot a participations-ben (csak authMethod és codeUsed!)
- 🚫 Ne tárold a teljes qrData-t az authQRCodes-ben (csak a szükséges mezőket!)
- 🚫 Ne legyen 1 órás lejárat a user QR-knál (max 5 perc!)

---

## 📝 Implementációs Sorrend

1. Firestore Collections létrehozása (ezt te csinálod)
2. Backend Functions implementálása (ezt én csinálom)
3. Frontend implementáció (ezt én csinálom)
4. Security Rules beállítása (ezt te csinálod)
