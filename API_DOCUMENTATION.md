# ClaimsMitra Backend - API Documentation for Postman Testing

> **Base URL:** `http://localhost:3000/api/v1`
> **Auth Header:** ` Authorization: Bearer <access_token>`

---
 
## 📋 Table of Contents 
1. [Testing Flow](#testing-flow)
2. [Authentication APIs](#1-authentication-apis)
3. [Admin APIs](#2-admin-apis)
4. [Assigner APIs](#3-assigner-apis)
5. [Surveyor APIs](#4-surveyor-apis)
6. [Survey Type APIs](#5-survey-type-specific-apis)
7. [Public APIs](#6-public-apis)

---

## 🔄 Testing Flow

### Recommended Testing Order:
```
1. Create Admin (manually in DB or seed) → Admin Login
2. Admin creates Assigner → Activate Assigner
3. Surveyor self-registers → Admin verifies & activates Surveyor
4. Assigner Login → Create Survey
5. Surveyor Login → Accept Survey → Complete Survey Flow
```

### Initial Setup:
Before testing, ensure you have at least one admin in the database:
```sql
INSERT INTO admins (full_name, email, phone, password_hash, is_super_admin, is_active)
VALUES ('Super Admin', 'admin@claimsmitra.com', '9999999999', 
        '$2a$10$MQfGLG9OpfxxLCa4T258B.azt1j4paF76KdYK/46COPeqGYdzyvV6', TRUE, TRUE);
```
**Password:** Use bcrypt to hash your password (e.g., `password123`)

---

## 1. Authentication APIs

### 1.1 Admin Authentication

#### 🔐 Admin Login
```
POST /auth/admin/login
```
**Headers:** `Content-Type: application/json`

**Request Body:**
```json
{
  "email": "admin@claimsmitra.com",
  "password": "password123"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": 1,
      "full_name": "Super Admin",
      "email": "admin@claimsmitra.com",
      "phone": "9999999999",
      "is_super_admin": true,
      "profile_picture_url": null
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIs...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
      "expiresIn": "1h"
    }
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

---

#### 🔄 Admin Refresh Token
```
POST /auth/admin/refresh-token
```
**Request Body:**
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Token refreshed",
  "data": {
    "tokens": {
      "accessToken": "new_access_token",
      "refreshToken": "new_refresh_token",
      "expiresIn": "1h"
    }
  }
}
```

---

#### 🚪 Admin Logout
```
POST /auth/admin/logout
```
**Headers:** `Authorization: Bearer <access_token>`

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

#### 📧 Admin Forgot Password
```
POST /auth/admin/forgot-password
```
**Request Body:**
```json
{
  "email": "admin@claimsmitra.com"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Password reset link generated. Check your email or use the token directly.",
  "data": {
    "reset_token": "a7b3c9d2e5f8g1h4i7j0k3l6m9n2o5p8...",
    "expires_in": "1 hour",
    "reset_url": "http://localhost:3000/api/v1/public/reset-password/a7b3c9d2..."
  }
}
```

**What Happens:**
1. A reset token is generated and stored in `password_reset_tokens` table
2. An email is sent to the user with a reset link (if email configured)
3. Token is returned in response for mobile app usage
4. The reset link expires in 1 hour

---

#### 🔐 Admin Reset Password (API)
```
POST /auth/admin/reset-password
```
**Request Body:**
```json
{
  "token": "your_reset_token_from_email",
  "new_password": "newpassword123"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Password reset successful"
}
```

**Error Response (400):**
```json
{
  "success": false,
  "message": "Invalid or expired reset token"
}
```

---

#### 🌐 Password Reset Web Page (EJS)
```
GET /public/reset-password/:token
```
**Description:** Opens a web page with a password reset form.

**URL Example:** `http://localhost:3000/api/v1/public/reset-password/abc123token`

**Form Submission:**
```
POST /public/reset-password/:token
```
**Form Fields:** `new_password`, `confirm_password`

**Success:** Redirects to success page  
**Error:** Shows error page for expired/invalid tokens

---

### 1.2 Assigner Authentication

> ⚠️ **Important:** Assigners cannot self-register. They are created by Admin via `POST /admin/assigners` and must be activated before login.

**Registration Flow:**
1. Admin creates Assigner: `POST /admin/assigners`
2. Admin activates Assigner: `PUT /admin/assigners/:id/activate`
3. Assigner can now login

---

#### 🔐 Assigner Login
```
POST /auth/assigner/login
```
**Request Body:**
```json
{
  "email": "assigner@insurance.com",
  "password": "password123"
}
```
OR
```json
{
  "phone": "9876543210",
  "password": "password123"
}
```

**Expected Response (200):** Same structure as Admin Login

**Error Response (403):** (If account not activated)
```json
{
  "success": false,
  "message": "Account is not activated. Please contact admin."
}
```

---

#### 🔄 Assigner Refresh Token
```
POST /auth/assigner/refresh-token
```
**Request Body:**
```json
{
  "refresh_token": "your_refresh_token"
}
```

---

#### 🚪 Assigner Logout
```
POST /auth/assigner/logout
```
**Headers:** `Authorization: Bearer <access_token>`

---

#### 📧 Assigner Forgot Password
```
POST /auth/assigner/forgot-password
```
**Request Body:**
```json
{
  "email": "assigner@insurance.com"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "If this email exists, a reset link has been sent"
}
```

---

#### 🔐 Assigner Reset Password
```
POST /auth/assigner/reset-password
```
**Request Body:**
```json
{
  "token": "reset_token_from_email",
  "new_password": "newpassword123"
}
```

---

### 1.3 Surveyor Authentication

#### 📝 Surveyor Registration (Self-Registration with KYC Documents)
```
POST /auth/surveyor/register
Content-Type: multipart/form-data
```

> **Note:** PIN is NOT required during registration. Surveyor sets their MPIN after first login via `/surveyor/set-pin` (industry standard).

**Form Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| full_name | string | ✅ | Letters and spaces only |
| email | string | ✅ | Valid email format |
| phone | string | ✅ | Exactly 10 digits |
| password | string | ✅ | Minimum 6 characters |
| business_address | string | ❌ | Operating address |
| city | string | ❌ | City name |
| state | string | ❌ | State name |
| pincode | string | ❌ | 6-digit pincode |
| surveyor_license_id | string | ❌ | License ID (alphanumeric) |
| profile_picture | File | ❌ | Professional headshot (JPG/PNG) |
| government_id | File | ❌ | Aadhar, Driver's License (JPG/PNG/PDF) |
| proof_of_address | File | ❌ | Utility Bill (JPG/PNG/PDF) |
| surveyor_license | File | ❌ | License certificate (JPG/PNG/PDF) |

**Postman Example:**
```
Key                   Value
─────────────────────────────────────────────
full_name             Ramesh Kumar
email                 ramesh@example.com
phone                 9876543210
password              Test@123
business_address      123 Main Street, Delhi
city                  Delhi
state                 Delhi
pincode               110001
surveyor_license_id   SL-2024-001
profile_picture       [File: headshot.jpg]
government_id         [File: aadhar.pdf]
proof_of_address      [File: utility_bill.jpg]
surveyor_license      [File: license.pdf]
```

**Expected Response (201):**
```json
{
  "success": true,
  "message": "Surveyor registered successfully",
  "data": {
    "id": 1,
    "profile_picture_url": "/uploads/profiles/abc123.jpg",
    "documents_uploaded": 3,
    "documents": [
      { "type": "government_id", "name": "aadhar.pdf", "url": "/uploads/documents/abc123.pdf" },
      { "type": "proof_of_address", "name": "utility_bill.jpg", "url": "/uploads/documents/def456.jpg" },
      { "type": "surveyor_license", "name": "license.pdf", "url": "/uploads/documents/ghi789.pdf" }
    ],
    "message": "Registration successful. Please wait for admin verification."
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "message": "Phone or email already registered"
}
```

---

#### 🔐 Surveyor Login (Password)
```
POST /auth/surveyor/login
```
**Request Body:**
```json
{
  "phone": "9876543210",
  "password": "password123"
}
```

**Error Response (403):** (If not verified)
```json
{
  "success": false,
  "message": "Account verification pending. Please wait for admin approval."
}
```

---

#### 🔢 Surveyor Login (PIN - Quick Login)
```
POST /auth/surveyor/login-pin
```
> **Note:** MPIN must be set first via `/surveyor/set-pin` after first login with password.

**Request Body:**
```json
{
  "phone": "9876543210",
  "pin": "1234"
}
```

**Expected Response (200):** Same as regular login

**Error Response (400):** If MPIN not set:
```json
{
  "success": false,
  "message": "MPIN not set. Please login with password and set your MPIN first."
}
```

---

#### 🔐 Set MPIN (After First Login)
```
POST /surveyor/set-pin
Authorization: Bearer <access_token>
```
> Called after first password login to enable quick PIN login.

**Request Body:**
```json
{
  "pin": "1234",
  "confirm_pin": "1234"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "MPIN set successfully",
  "data": {
    "message": "MPIN set successfully. You can now use quick login.",
    "has_pin": true
  }
}
```

---

#### 🔄 Change MPIN
```
POST /surveyor/change-pin
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "current_pin": "1234",
  "new_pin": "5678",
  "confirm_pin": "5678"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "MPIN changed successfully"
}
```

---

#### 🔄 Surveyor Refresh Token
```
POST /auth/surveyor/refresh-token
```
**Request Body:**
```json
{
  "refresh_token": "your_refresh_token"
}
```

---

#### 📧 Surveyor Forgot Password
```
POST /auth/surveyor/forgot-password
```
**Request Body:**
```json
{
  "email": "surveyor@email.com"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "If this email exists, a reset link has been sent"
}
```

---

#### 🔐 Surveyor Reset Password
```
POST /auth/surveyor/reset-password
```
**Request Body:**
```json
{
  "token": "reset_token_from_email",
  "new_password": "newpassword123"
}
```

---

## 2. Admin APIs

> **All Admin APIs require:** `Authorization: Bearer <admin_access_token>`

### 2.1 Profile Management

#### 👤 Get Admin Profile
```
GET /admin/profile
```

**Expected Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "full_name": "Super Admin",
    "email": "admin@claimsmitra.com",
    "phone": "9999999999",
    "profile_picture_url": null,
    "is_super_admin": true,
    "last_login_at": "2025-12-06T12:00:00Z"
  }
}
```

---

#### ✏️ Update Admin Profile
```
PUT /admin/profile
```
**Request Body:**
```json
{
  "full_name": "Updated Admin Name",
  "phone": "9999999998"
}
```

---

#### 🔑 Change Admin Password
```
PUT /admin/change-password
```
**Request Body:**
```json
{
  "current_password": "oldpassword123",
  "new_password": "newpassword123"
}
```

---

### 2.2 Admin Management (Super Admin Only)

#### ➕ Create Admin
```
POST /admin/admins
```
**Request Body:**
```json
{
  "full_name": "New Admin",
  "email": "newadmin@claimsmitra.com",
  "phone": "9888888888",
  "password": "password123",
  "is_super_admin": false
}
```

---

#### 📋 List All Admins
```
GET /admin/admins?page=1&limit=10
```

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (1-100, default: 10)

---

### 2.3 Assigner Management

#### ➕ Create Assigner
```
POST /admin/assigners
```
**Request Body:**
```json
{
  "phone": "9876543210",
  "email": "assigner@insurance.com",
  "password": "password123",
  "company_name": "ABC Insurance Co.",
  "contact_person_name": "John Manager",
  "address": "456 Insurance Street, Delhi",
  "city": "Delhi",
  "state": "Delhi",
  "pincode": "110001"
}
```

**Expected Response (201):**
```json
{
  "success": true,
  "message": "Assigner created successfully",
  "data": {
    "id": 1,
    "phone": "9876543210",
    "email": "assigner@insurance.com",
    "is_active": false
  }
}
```

---

#### 📋 List All Assigners
```
GET /admin/assigners?page=1&limit=10
```

---

#### 👁️ Get Single Assigner
```
GET /admin/assigners/:id
```
Example: `GET /admin/assigners/1`

---

#### ✏️ Update Assigner
```
PUT /admin/assigners/:id
```
**Request Body:**
```json
{
  "company_name": "Updated Company Name",
  "contact_person_name": "Updated Contact"
}
```

---

#### ✅ Activate Assigner
```
PUT /admin/assigners/:id/activate
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Assigner activated successfully"
}
```

---

#### ❌ Deactivate Assigner
```
PUT /admin/assigners/:id/deactivate
```

---

### 2.4 Surveyor Management

> **Categories, Investigator & Prime (v2 §1).** Three separate concepts:
> - **`is_investigator`** — baseline capability, `true` for every approved surveyor. **Not** a category.
> - **`categories`** — licensed lines of business granted by admin. One of:
>   `motor`, `marine`, `fire`, `engineering`, `miscellaneous`, `lop`, `hull`, `aviation`.
> - **`is_prime`** — **derived**, never stored: `true` when the surveyor holds ≥ 1 unexpired category.
>   A surveyor with no categories is investigator-only and is **not** Prime.
>
> Broadcast routing: `motor_spot`/`motor_final` → `motor`; `marine_final`/`marine_cargo_investigation`
> → `marine`; `investigation` → open to all investigators. The other six categories are licence
> metadata only until their case types exist.

#### 📋 List All Surveyors
```
GET /admin/surveyors?page=1&limit=10&status=pending&category=motor&prime=true
```

**Query Parameters:**
- `page`, `limit`: Pagination
- `status`: `active` | `inactive`
- `verification`: Filter by verification_status (`pending`, `under_review`, `verified`, `rejected`)
- `search`: Matches phone, email or full name
- `category`: *(v2)* Only surveyors holding this category
- `prime`: *(v2)* `true` = Prime only, `false` = investigator-only

Each row includes `is_prime`, `categories` (array, may be empty) and `is_investigator`.

---

#### 👁️ Get Single Surveyor
```
GET /admin/surveyors/:id
```

Additionally returns `is_prime`, `categories`, `is_investigator`, and `category_grants`:

```json
{
  "category_grants": [
    {
      "id": 12,
      "category": "motor",
      "license_number": "IRDA/SUR/2019/0042",
      "valid_until": "2027-03-31",
      "granted_at": "2026-07-22T10:14:00.000Z",
      "granted_by_name": "Admin User"
    }
  ]
}
```

---

#### ✅ Verify Surveyor (Approve KYC)
```
PUT /admin/surveyors/:id/verify
```

**Request Body (optional, v2):** admin decides the licensed categories at approval time.
Omit `categories` entirely to approve as investigator-only.

```json
{
  "categories": [
    "marine",
    { "category": "motor", "license_number": "IRDA/SUR/2019/0042", "valid_until": "2027-03-31" }
  ]
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Surveyor verified and activated successfully",
  "data": { "categories": ["marine", "motor"], "is_prime": true }
}
```

---

#### 🏷️ Get Surveyor Categories *(v2)*
```
GET /admin/surveyors/:id/categories
```

```json
{
  "success": true,
  "data": {
    "available": ["motor","marine","fire","engineering","miscellaneous","lop","hull","aviation"],
    "granted": [ /* full grant rows */ ],
    "is_prime": true
  }
}
```

---

#### 🏷️ Replace Surveyor Categories *(v2)*
```
PUT /admin/surveyors/:id/categories
```

Send the **complete desired set** — this replaces all existing grants.
Send `[]` to revoke everything (surveyor becomes investigator-only, loses the Prime badge).

```json
{ "categories": ["motor", { "category": "hull", "valid_until": "2028-01-31" }] }
```

---

#### ❌ Reject Surveyor
```
PUT /admin/surveyors/:id/reject
```
**Request Body:**
```json
{
  "rejection_reason": "Invalid government ID document"
}
```

---

#### ✅ Activate Surveyor
```
PUT /admin/surveyors/:id/activate
```

---

#### ❌ Deactivate Surveyor
```
PUT /admin/surveyors/:id/deactivate
```

---

#### 📄 Get Surveyor Documents
```
GET /admin/surveyors/:id/documents
```

---

#### ✅ Verify Surveyor Document
```
PUT /admin/surveyors/:id/documents/:docId/verify
```

---

### 2.4b Billing *(v2 §3)*

> The `pricing_tiers` slab charge remains an **advance**, paid before the surveyor travels.
> The itemised bill below is the **final invoice**, and the advance is **credited** against it.
> `balance_due = total_amount − advance_adjusted − amount_paid`.
>
> Lifecycle: `draft → issued → settled | cancelled`. An **issued** bill is a tax document and
> cannot be edited — cancel it and raise a replacement. **Direct-assign surveys are never
> billed.**

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/admin/billing/pending` | Work queue — completed broadcast surveys with no bill |
| GET | `/admin/billing/bills` | All bills; filters `status`, `assigner_id`, `search` |
| GET | `/admin/billing/surveys/:surveyId/draft` | Prefilled draft, or `{ existing_bill }` |
| POST | `/admin/billing/surveys/:surveyId` | Create a draft |
| PUT | `/admin/billing/bills/:id` | Update a draft (400 on issued/settled) |
| POST | `/admin/billing/bills/:id/issue` | Allocate invoice number, notify assigner |
| POST | `/admin/billing/bills/:id/settle` | `{ amount?, method?, notes? }` — omit `amount` to mark fully settled |
| POST | `/admin/billing/bills/:id/cancel` | `{ reason }` (required) |

**Editable quantity fields only:** `fee_amount`, `conveyance_km`, `conveyance_rate`,
`da_toll_amount`, `photo_count`, `photo_rate`, `gst_percent`, `notes`.
Every amount, the tax split, the total and the balance are **derived server-side** — never
submit them.

The draft response includes `prefill_notes` and `warnings` written for the admin:

> ⚠️ **`conveyance_km` is an unreliable hint.** `surveys.distance_from_assigner_km` is written
> three different ways by three code paths (assigner-office→incident at creation, and
> surveyor→incident overwritten in place on a GET), so existing rows are an untagged mix and
> it is `NULL` whenever the assigner has no coordinates. The admin must confirm the real
> distance. The UI surfaces this note next to the field.

**Before issuing any invoice**, set `platform_state` and `platform_gstin` in system config —
place of supply is derived from `platform_state` vs `assigners.state`, and with it unset every
bill falls back to IGST, producing incorrect tax documents.

---

### 2.4c Assigner Ledger *(v2 §4)*

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/admin/assigners/:id/ledger` | Paginated statement |
| GET | `/admin/assigners/:id/ledger/summary` | Balance, bank details, integrity check |
| POST | `/admin/assigners/:id/ledger` | Post an adjustment or record a refund |

```json
{ "entry_type": "debit", "amount": 804, "description": "Refund by NEFT, UTR ...", "reference_type": "refund" }
```

**Recording a bank refund is a DEBIT** — it reduces what the platform owes, bringing an
`admin_owes` balance back to zero. `description` is required so the statement stays auditable.

> `summary.integrity.consistent === false` means the stored running balance has drifted from
> the sum of the entries — the statement cannot be trusted until that is investigated. The
> admin ledger page surfaces it rather than hiding it.

---

### 2.5 System Configuration

#### ⚙️ Get All Config
```
GET /admin/config
```

---

#### ⚙️ Update Config
```
PUT /admin/config/:key
```
**Request Body:**
```json
{
  "value": "new_value"
}
```

---

### 2.6 Pricing Tiers

#### 📋 Get Pricing Tiers
```
GET /admin/pricing-tiers
```

---

#### ➕ Create Pricing Tier
```
POST /admin/pricing-tiers
```
**Request Body:**
```json
{
  "min_distance_km": 0,
  "max_distance_km": 10,
  "base_price": 500,
  "emergency_multiplier": 1.5
}
```

---

#### ✏️ Update Pricing Tier
```
PUT /admin/pricing-tiers/:id
```

---

#### 🗑️ Delete Pricing Tier
```
DELETE /admin/pricing-tiers/:id
```

---

### 2.7 Coupons

#### ➕ Create Coupon
```
POST /admin/coupons
```
**Request Body:**
```json
{
  "code": "SAVE20",
  "description": "20% off on first survey",
  "discount_type": "percentage",
  "discount_value": 20,
  "min_order_amount": 100,
  "max_discount_amount": 500,
  "usage_limit": 100,
  "valid_from": "2025-12-01T00:00:00Z",
  "valid_until": "2025-12-31T23:59:59Z"
}
```

**Validation Rules:**
- `discount_type`: `percentage` or `fixed`
- `discount_value`: Positive number
- `valid_from`, `valid_until`: ISO 8601 date format

---

#### 📋 List Coupons
```
GET /admin/coupons
```

---

#### ✏️ Update Coupon
```
PUT /admin/coupons/:id
```

---

#### 🗑️ Delete Coupon
```
DELETE /admin/coupons/:id
```

---

## 3. Assigner APIs

> **All Assigner APIs require:** `Authorization: Bearer <assigner_access_token>`

### 3.1 Profile

#### 👤 Get Profile
```
GET /assigner/profile
```

---

#### 📒 My Ledger *(v2 §4)*
```
GET /assigner/ledger?page=1&limit=50
GET /assigner/ledger/summary
```

**Sign convention — the one thing to remember:**

| Balance | Meaning |
|---|---|
| `> 0` | The **assigner owes** the platform |
| `< 0` | The **platform owes** the assigner (render as a **credit**, never a negative amount due) |
| `0` | Settled |

`entry_type` is `debit` (assigner owes more) or `credit` (owes less). **`amount` is always
positive** — the direction comes from `entry_type`, never from the sign.

`/summary` returns a ready-made description so no client has to re-derive the convention:

```json
{
  "balance": -804.00,
  "direction": "admin_owes",
  "amount": 804.00,
  "label": "Credit in your favour",
  "outstanding_invoices": []
}
```

---

#### 🧾 Get the Itemised Bill for a Survey *(v2 §3)*
```
GET /assigner/surveys/:id/bill
```

```json
{
  "success": true,
  "data": {
    "bill": { "invoice_number": "CM/2026-27/00042", "taxable_value": 2800.00,
              "gst_percent": 18.00, "cgst_amount": 252.00, "sgst_amount": 252.00,
              "igst_amount": 0.00, "total_amount": 3304.00,
              "advance_adjusted": 2500.00, "balance_due": 804.00, "status": "issued" },
    "billing_state": "balance_due",
    "message": "₹804.00 is due on invoice CM/2026-27/00042."
  }
}
```

`billing_state` is one of:

| State | Meaning |
|---|---|
| `not_billable` | Direct-assign survey — free, never billed. `bill` is `null`. |
| `awaiting_bill` | Admin has not issued the invoice yet. `bill` is `null`. |
| `balance_due` | `bill.balance_due > 0` |
| `settled` | Nothing outstanding |

> ⚠️ **Draft bills are never returned** — an admin is still editing those numbers.
>
> ⚠️ **`balance_due` can be negative.** That means the advance exceeded the invoice and the
> platform owes the assigner. Render it as a credit, never as a negative amount due.

---

#### 👥 Get My Surveyor Team *(v2 §2)*
```
GET /assigner/team
```

```json
{
  "success": true,
  "data": {
    "is_direct_assign": true,
    "members":  [ /* ACCEPTED only — the only surveyors direct-assign will allow */ ],
    "pending":  [ /* invited, not yet answered — NOT assignable */ ],
    "declined": [ /* refused — NOT assignable, may be re-invited */ ]
  }
}
```

Every row carries `status`, `invited_by`, `invited_at`, `responded_at`, plus the §1 fields
`is_prime`, `categories`, `is_investigator`.

> ⚠️ Only put **`members`** in a surveyor picker. Direct assign rejects anything else with
> `TEAM_INVITE_NOT_ACCEPTED`.

---

#### ➕ Invite a Surveyor to My Team *(v2 §2)*
```
POST /assigner/team/invite
```

```json
{ "phone": "9876543210" }
```
Accepts `phone` **or** `surveyor_id`. Creates a **pending** invite and notifies the surveyor —
they are not added until they accept. Re-inviting a declined surveyor resets them to pending.

Error codes: `DIRECT_ASSIGN_DISABLED` (403), `SURVEYOR_NOT_FOUND` (404),
`SURVEYOR_NOT_VERIFIED` (400), `409` when already an accepted member.

---

#### ➖ Remove from My Team *(v2 §2)*
```
DELETE /assigner/team/:surveyorId
```
Also cancels a pending invite.

---

#### ✏️ Update Profile
```
PUT /assigner/profile
```
**Request Body:**
```json
{
  "company_name": "Updated Insurance Co.",
  "contact_person_name": "Updated Name",
  "address": "New Address",
  "latitude": 28.6139,
  "longitude": 77.2090
}
```

---

#### 🔑 Change Password
```
PUT /assigner/change-password
```
**Request Body:**
```json
{
  "current_password": "oldpass",
  "new_password": "newpass123"
}
```

---

### 3.2 Survey Creation & Management

> **Note:** Survey creation uses `multipart/form-data` for file uploads

---

#### ➕ Create Survey
```
POST /assigner/surveys
Content-Type: multipart/form-data
Authorization: Bearer <assigner_token>
```

---

### 📋 POSTMAN EXAMPLES (Copy-Paste Ready)

---

#### 🚗 Example 1: Motor Spot Survey (with Documents)

**Postman Settings:**
- Method: `POST`
- URL: `http://localhost:3000/api/v1/assigner/surveys`
- Body Type: `form-data`

| Key | Value | Type |
|-----|-------|------|
| survey_type | `motor_spot` | Text |
| contact_person_name | `Ramesh Kumar` | Text |
| contact_person_mobile | `9876543210` | Text |
| contact_person_available | `true` | Text |
| location_method | `pincode_entry` | Text |
| pincode | `110001` | Text |
| city | `Delhi` | Text |
| state | `Delhi` | Text |
| address | `123 Main Street, Connaught Place` | Text |
| case_reference | `CASE-2025-001` | Text |
| name_of_insured | `Rakesh Sharma` | Text |
| policy_number | `POL123456` | Text |
| cause_of_loss | `Accident near traffic signal` | Text |
| instructions | `Please verify vehicle damage` | Text |
| is_emergency | `false` | Text |
| vehicle_category | `private` | Text |
| vehicle_type | `motor_car` | Text |
| vehicle_number | `UP32 AB 1234` | Text |
| document_types | `["rc", "dl"]` | Text |
| documents | (select RC file) | File |
| documents | (select DL file) | File |

**Expected Response (201):**
```json
{
  "success": true,
  "message": "Survey created successfully",
  "data": {
    "id": 1,
    "laid": "L25-12-08 20:00",
    "survey_type": "motor_spot",
    "status": "pending",
    "type_details_id": 1,
    "documents_uploaded": 2,
    "documents": [
      { "id": 1, "type": "rc", "filename": "uuid.pdf", "url": "/uploads/documents/uuid.pdf" },
      { "id": 2, "type": "dl", "filename": "uuid.jpg", "url": "/uploads/documents/uuid.jpg" }
    ]
  }
}
```

---

#### � Example 2: Motor Final Survey (Commercial Vehicle)

| Key | Value | Type |
|-----|-------|------|
| survey_type | `motor_final` | Text |
| contact_person_name | `Suresh Yadav` | Text |
| contact_person_mobile | `9988776655` | Text |
| contact_person_available | `false` | Text |
| alternate_whatsapp_number | `9876543211` | Text |
| location_method | `manual_coordinates` | Text |
| latitude | `28.6139` | Text |
| longitude | `77.2090` | Text |
| pincode | `110001` | Text |
| city | `Delhi` | Text |
| state | `Delhi` | Text |
| address | `Industrial Area, Okhla` | Text |
| case_reference | `CASE-2025-002` | Text |
| name_of_insured | `ABC Transport Co` | Text |
| policy_number | `POL789012` | Text |
| cause_of_loss | `Truck collision on highway` | Text |
| instructions | `Check engine and chassis damage` | Text |
| is_emergency | `false` | Text |
| vehicle_category | `commercial` | Text |
| vehicle_type | `goods_carrier` | Text |
| vehicle_number | `DL01 TC 5678` | Text |
| document_types | `["rc", "policy", "fir"]` | Text |
| documents | (select RC file) | File |
| documents | (select Policy file) | File |
| documents | (select FIR file) | File |

---

#### 🚢 Example 3: Marine Final Survey (with Invoices & GR)

| Key | Value | Type |
|-----|-------|------|
| survey_type | `marine_final` | Text |
| contact_person_name | `Vikram Mehta` | Text |
| contact_person_mobile | `9123456789` | Text |
| contact_person_available | `true` | Text |
| location_method | `pincode_entry` | Text |
| pincode | `400001` | Text |
| city | `Mumbai` | Text |
| state | `Maharashtra` | Text |
| address | `Warehouse 5, Nhava Sheva Port` | Text |
| case_reference | `MARINE-2025-001` | Text |
| name_of_insured | `Global Traders Pvt Ltd` | Text |
| policy_number | `MAR567890` | Text |
| cause_of_loss | `Water damage during transit` | Text |
| instructions | `Inspect cargo condition and packaging` | Text |
| is_emergency | `false` | Text |
| name_of_consignee | `ABC Imports Ltd` | Text |
| name_of_consignor | `XYZ Exports Inc` | Text |
| commodity | `Electronic Components` | Text |
| invoices | `[{"invoice_number":"INV-2025-001","invoice_date":"2025-12-08","invoice_amount":150000.50},{"invoice_number":"INV-2025-002","invoice_date":"2025-12-07","invoice_amount":85000}]` | Text |
| gr_entries | `[{"gr_number":"GR-4582/24","gr_date":"2025-12-08"},{"gr_number":"GR-4583/24","gr_date":"2025-12-07"}]` | Text |
| document_types | `["invoice", "gr", "policy"]` | Text |
| documents | (select Policy file) | File |
| invoice_files | (select Invoice 1 file) | File |
| invoice_files | (select Invoice 2 file) | File |
| gr_files | (select GR 1 file) | File |
| gr_files | (select GR 2 file) | File |

---

#### � Example 4: Marine Cargo Investigation

| Key | Value | Type |
|-----|-------|------|
| survey_type | `marine_cargo_investigation` | Text |
| contact_person_name | `Amit Patel` | Text |
| contact_person_mobile | `9876512340` | Text |
| location_method | `pincode_entry` | Text |
| pincode | `380001` | Text |
| city | `Ahmedabad` | Text |
| state | `Gujarat` | Text |
| address | `ICD Container Yard` | Text |
| case_reference | `CARGO-INV-2025-001` | Text |
| name_of_consignee | `Gujarat Industries` | Text |
| name_of_consignor | `Shanghai Exports` | Text |
| commodity | `Auto Parts and Machinery` | Text |
| invoices | `[{"invoice_number":"CN-45678","invoice_date":"2025-12-05","invoice_amount":500000}]` | Text |
| gr_entries | `[{"gr_number":"BL-2025-1234","gr_date":"2025-12-06"}]` | Text |

---

#### 🔍 Example 5: Investigation Survey - Vehicle Loss

| Key | Value | Type |
|-----|-------|------|
| survey_type | `investigation` | Text |
| contact_person_name | `Priya Singh` | Text |
| contact_person_mobile | `9998887776` | Text |
| contact_person_available | `true` | Text |
| location_method | `pincode_entry` | Text |
| pincode | `226001` | Text |
| city | `Lucknow` | Text |
| state | `Uttar Pradesh` | Text |
| address | `Hazratganj Main Road` | Text |
| case_reference | `INV-2025-001` | Text |
| name_of_insured | `Mahesh Kumar` | Text |
| policy_number | `INV987654` | Text |
| cause_of_loss | `Vehicle theft from parking` | Text |
| instructions | `Verify theft claim and FIR details` | Text |
| loss_item_type | `vehicle` | Text |
| investigation_vehicle_number | `UP32 XY 9999` | Text |
| document_types | `["fir", "rc", "policy"]` | Text |
| documents | (select FIR file) | File |
| documents | (select RC file) | File |

---

#### 🔍 Example 6: Investigation Survey - Cattle Loss

| Key | Value | Type |
|-----|-------|------|
| survey_type | `investigation` | Text |
| contact_person_name | `Ramchandra Verma` | Text |
| contact_person_mobile | `9876540001` | Text |
| location_method | `pincode_entry` | Text |
| pincode | `302001` | Text |
| city | `Jaipur` | Text |
| state | `Rajasthan` | Text |
| address | `Village Sanganer` | Text |
| case_reference | `CATTLE-2025-001` | Text |
| name_of_insured | `Ramchandra Verma` | Text |
| cause_of_loss | `Cattle death due to illness` | Text |
| loss_item_type | `cattle` | Text |
| cattle_tag_number | `RJ-CAT-2025-567` | Text |
| cattle_name | `Lakshmi` | Text |

---

#### 🔍 Example 7: Investigation Survey - Human (Personal Accident)

| Key | Value | Type |
|-----|-------|------|
| survey_type | `investigation` | Text |
| contact_person_name | `Neha Gupta` | Text |
| contact_person_mobile | `9123456001` | Text |
| location_method | `pincode_entry` | Text |
| pincode | `560001` | Text |
| city | `Bangalore` | Text |
| state | `Karnataka` | Text |
| address | `MG Road, Near Metro Station` | Text |
| case_reference | `PA-2025-001` | Text |
| name_of_insured | `Rajesh Gupta` | Text |
| policy_number | `PA123456` | Text |
| cause_of_loss | `Accident during work` | Text |
| loss_item_type | `human` | Text |
| human_name | `Rajesh Gupta` | Text |
| human_contact_number | `9876540002` | Text |
| human_relation | `Self` | Text |

---

#### 🔍 Example 8: Investigation Survey - Others

| Key | Value | Type |
|-----|-------|------|
| survey_type | `investigation` | Text |
| contact_person_name | `Anil Sharma` | Text |
| contact_person_mobile | `9876543999` | Text |
| location_method | `pincode_entry` | Text |
| pincode | `600001` | Text |
| city | `Chennai` | Text |
| state | `Tamil Nadu` | Text |
| address | `T Nagar Shopping Complex` | Text |
| case_reference | `OTHER-2025-001` | Text |
| name_of_insured | `Sharma Electronics` | Text |
| cause_of_loss | `Fire damage to shop inventory` | Text |
| loss_item_type | `others` | Text |
| other_loss_item_name | `Shop Inventory and Equipment` | Text |

---

### 📤 Upload Additional Documents (to existing survey)

```
POST /assigner/surveys/:id/documents
Content-Type: multipart/form-data
Authorization: Bearer <assigner_token>
```

| Key | Value | Type |
|-----|-------|------|
| document_types | `["policy", "fir"]` | Text |
| documents | (select file 1) | File |
| documents | (select file 2) | File |

**Response (201):**
```json
{
  "success": true,
  "message": "2 document(s) uploaded",
  "data": {
    "documents": [
      { "id": 3, "type": "policy", "url": "/uploads/documents/uuid.pdf" }
    ]
  }
}
```

---

### 🗑️ Delete Document

```
DELETE /assigner/surveys/:id/documents/:docId
Authorization: Bearer <assigner_token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Document deleted"
}
```

---


#### 📋 List Surveys
```
GET /assigner/surveys?page=1&limit=10&status=pending
```

**Query Parameters:**
- `page`, `limit`: Pagination
- `status`: Filter by status
- `survey_type`: Filter by type
- `search`: Search by LAID, case reference, or contact name

---

#### 👁️ Get Survey Details
```
GET /assigner/surveys/:id
```

Returns survey with type-specific details (motor/marine/investigation) and related invoices/GR entries for marine surveys.

---

#### 📊 Get Survey Status History
```
GET /assigner/surveys/:id/status-history
```

---

#### 📸 Get Survey Photos
```
GET /assigner/surveys/:id/photos
```

---

#### 📄 Get Survey Documents
```
GET /assigner/surveys/:id/documents
```

---

#### 📑 Get Survey Reports
```
GET /assigner/surveys/:id/reports
```

---

#### ✅ Accept Report
```
PUT /assigner/surveys/:id/reports/:reportId/accept
```

---

#### ❌ Reject Report
```
PUT /assigner/surveys/:id/reports/:reportId/reject
```
**Request Body:**
```json
{
  "rejection_reason": "Report is incomplete. Missing vehicle damage photos."
}
```

---

#### 📍 Get Surveyor Live Location
```
GET /assigner/surveys/:id/surveyor-location
```

**Expected Response (200):**
```json
{
  "success": true,
  "data": {
    "latitude": 28.6139,
    "longitude": 77.2090,
    "updated_at": "2025-12-06T12:30:00Z"
  }
}
```

---

### 3.3 SMS Location

#### 📱 Send Location SMS
```
POST /assigner/surveys/:id/send-location-sms
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Location SMS sent successfully",
  "data": {
    "sms_link_token": "abc123xyz"
  }
}
```

---

#### 🔄 Resend Location SMS
```
POST /assigner/surveys/:id/resend-location-sms
```

---

### 3.4 Payment

#### 💰 Calculate Price
```
POST /assigner/surveys/:id/calculate-price
```

**Expected Response (200):**
```json
{
  "success": true,
  "data": {
    "distance_km": 15.5,
    "base_amount": 750,
    "emergency_charge": 0,
    "total_amount": 750
  }
}
```

---

#### 🎟️ Apply Coupon
```
POST /assigner/surveys/:id/apply-coupon
```
**Request Body:**
```json
{
  "coupon_code": "SAVE20"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "data": {
    "base_amount": 750,
    "discount_amount": 150,
    "final_amount": 600
  }
}
```

---

#### 💳 Initiate Payment
```
POST /assigner/surveys/:id/initiate-payment
```

**Expected Response (200):**
```json
{
  "success": true,
  "data": {
    "order_id": "order_abc123",
    "amount": 600,
    "currency": "INR",
    "gateway": "razorpay"
  }
}
```

---

#### ✅ Verify Payment
```
POST /assigner/surveys/:id/verify-payment
```
**Request Body:**
```json
{
  "razorpay_order_id": "order_abc123",
  "razorpay_payment_id": "pay_xyz789",
  "razorpay_signature": "signature_hash"
}
```

---

#### 📊 Payment History
```
GET /assigner/payments?page=1&limit=10
```

---

### 3.5 Chat

#### 💬 Get Chat Messages
```
GET /assigner/surveys/:id/chat
```

---

#### ✉️ Send Chat Message
```
POST /assigner/surveys/:id/chat
```
**Request Body:**
```json
{
  "message": "Please provide ETA update"
}
```

---

## 4. Surveyor APIs

> **All Surveyor APIs require:** `Authorization: Bearer <surveyor_access_token>`

### 4.1 Profile

#### 👤 Get Profile
```
GET /surveyor/profile
```

Returns `is_prime`, `categories`, `is_investigator` and `category_grants` *(v2 §1)* alongside
the profile fields. `categories` is always an array — empty means investigator-only, which is
a valid state, not an error. Read-only for the surveyor: only an admin can grant categories.

---

#### 👥 List My Team Invitations *(v2 §2)*
```
GET /surveyor/team-invites
```

```json
{
  "success": true,
  "data": {
    "is_prime": false,
    "accepting_removes_from_open_pool": true,
    "pending":  [ { "invite_id": 4, "status": "pending", "invited_by": "assigner",
                    "assigner_id": 7, "company_name": "Acme Insurance", "city": "Pune" } ],
    "accepted": [],
    "declined": []
  }
}
```

> ⚠️ **`accepting_removes_from_open_pool`** is the flag the UI must act on. When `true`, the
> surveyor is **not** Prime, so accepting removes them from open broadcasts entirely — they
> will then receive work only from that company, and those surveys are free (no platform
> payout). The UI must state this before they accept. **Never recompute this client-side.**
>
> `company_name` is nullable — fall back to `contact_person_name`.

---

#### ✅ Respond to a Team Invitation *(v2 §2)*
```
PUT /surveyor/team-invites/:assignerId
```

```json
{ "action": "accept" }
```
`action` is `accept` or `decline`. Returns `409` if already answered.

```json
{
  "success": true,
  "message": "Invitation accepted. You will now receive work directly from your company instead of open survey requests.",
  "data": { "status": "accepted", "excluded_from_open_broadcasts": true }
}
```

The `message` is written for humans — prefer showing it verbatim.

---

#### ✏️ Update Profile
```
PUT /surveyor/profile
```
**Request Body (multipart/form-data):**
- `full_name`: String
- `business_address`: String
- `profile_picture`: File (optional)

---

#### 🔑 Change Password
```
PUT /surveyor/change-password
```
**Request Body:**
```json
{
  "current_password": "oldpass",
  "new_password": "newpass123"
}
```

---

#### 🔢 Change PIN
```
PUT /surveyor/change-pin
```
**Request Body:**
```json
{
  "current_pin": "1234",
  "new_pin": "5678"
}
```

---

### 4.2 KYC Documents

#### 📤 Upload KYC Document
```
POST /surveyor/documents
```
**Request (multipart/form-data):**
- `document`: File (jpg, png, pdf)
- `document_type`: `government_id` | `proof_of_address` | `surveyor_license`

---

#### 📋 List My Documents
```
GET /surveyor/documents
```

---

#### 🗑️ Delete Document
```
DELETE /surveyor/documents/:id
```

---

### 4.3 Availability & Location

#### 🟢 Toggle Availability
```
PUT /surveyor/availability
```
**Request Body:**
```json
{
  "is_available": true
}
```

---

#### 📍 Update Location
```
PUT /surveyor/location
```
**Request Body:**
```json
{
  "latitude": 28.6139,
  "longitude": 77.2090
}
```

**Validation:**
- `latitude`: -90 to 90
- `longitude`: -180 to 180

---

### 4.4 Bank Details

#### 🏦 Update Bank Details
```
PUT /surveyor/bank-details
```
**Request Body:**
```json
{
  "bank_account_number": "1234567890123456",
  "bank_ifsc_code": "HDFC0001234",
  "bank_account_holder_name": "John Surveyor",
  "upi_id": "john@upi"
}
```

---

### 4.5 Survey Notifications

#### 🔔 Get New Survey Notifications
```
GET /surveyor/notifications?page=1&limit=10
```

---

#### ✅ Accept Survey Notification
```
POST /surveyor/notifications/:id/accept
```
**Request Body:**
```json
{
  "eta_minutes": 30
}
```

**Validation:** `eta_minutes` must be between 1-480

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Survey accepted",
  "data": {
    "survey_id": 1,
    "eta_minutes": 30
  }
}
```

---

#### ❌ Decline Survey Notification
```
POST /surveyor/notifications/:id/decline
```
**Request Body (optional):**
```json
{
  "reason": "Too far from my location"
}
```

---

### 4.6 Survey Execution

#### 📋 List Assigned Surveys
```
GET /surveyor/surveys?page=1&limit=10
```

---

#### 👁️ Get Survey Details
```
GET /surveyor/surveys/:id
```

---

#### 🚗 Start Transit (Begin Travel)
```
PUT /surveyor/surveys/:id/start-transit
```

---

#### 📍 Update Transit Location
```
POST /surveyor/surveys/:id/location-update
```
**Request Body:**
```json
{
  "latitude": 28.6200,
  "longitude": 77.2150
}
```

---

#### 🏁 Mark Arrived at Location
```
PUT /surveyor/surveys/:id/arrived
```

---

### 4.7 Photos & Documents

#### 🤳 Upload Selfie (Presence Verification)
```
POST /surveyor/surveys/:id/selfie
```
**Request (multipart/form-data):**
- `selfie`: Image file

---

#### 📸 Upload Photos (Multiple)
```
POST /surveyor/surveys/:id/photos
```
**Request (multipart/form-data):**
- `photos[]`: Multiple image files
- `photo_type`: `live` | `sync_mode` | `gallery`
- `captions[]`: Optional captions for each photo

---

#### 📸 Get Survey Photos
```
GET /surveyor/surveys/:id/photos
```

---

#### 🗑️ Delete Photo
```
DELETE /surveyor/surveys/:id/photos/:photoId
```

---

#### 📄 Upload Document
```
POST /surveyor/surveys/:id/documents
```
**Request (multipart/form-data):**
- `document`: File
- `document_type`: `rc` | `dl` | `policy` | `fir` | `gr` | `invoice` | `others`

---

### 4.8 Survey Completion

#### ✅ Complete Site Visit
```
PUT /surveyor/surveys/:id/complete-visit
```

---

#### 📑 Submit Report
```
POST /surveyor/surveys/:id/reports
```
**Request (multipart/form-data):**
- `report`: PDF file
- `surveyor_notes`: String (optional)

---

#### 📝 Update Notes
```
PUT /surveyor/surveys/:id/notes
```
**Request Body:**
```json
{
  "notes": "Extensive damage observed on front bumper and headlights"
}
```

---

### 4.9 Chat

#### 💬 Get Chat Messages
```
GET /surveyor/surveys/:id/chat
```

---

#### ✉️ Send Chat Message
```
POST /surveyor/surveys/:id/chat
```
**Request Body:**
```json
{
  "message": "On my way, will reach in 20 minutes"
}
```

---

## 5. Survey Type-Specific APIs

> **Requires:** `Authorization: Bearer <token>` (Assigner for POST/PUT, Any authenticated for GET)

### 5.1 Motor Details

#### ➕ Add Motor Details
```
POST /surveys/:id/motor-details
```
**Request Body:**
```json
{
  "vehicle_category": "private",
  "vehicle_type": "motor_car",
  "vehicle_number": "DL01AB1234",
  "workshop_name": "ABC Motors",
  "workshop_advisor_name": "Suresh",
  "workshop_advisor_contact": "9876543210"
}
```

**Vehicle Categories:** `private`, `commercial`

**Vehicle Types:** 
- `motor_car`, `tractor`, `motorcycle`, `others` (Private)
- `construction_equipment`, `bus`, `goods_carrier` (Commercial only)

**Vehicle Number Format:** `XX00XX0000` (e.g., DL01AB1234)

---

#### 👁️ Get Motor Details
```
GET /surveys/:id/motor-details
```

---

#### ✏️ Update Motor Details
```
PUT /surveys/:id/motor-details
```

---

### 5.2 Marine Details

#### ➕ Add Marine Details
```
POST /surveys/:id/marine-details
```
**Request Body:**
```json
{
  "name_of_consignee": "ABC Traders",
  "name_of_consignor": "XYZ Manufacturers",
  "commodity": "Electronic Components"
}
```

---

#### 👁️ Get Marine Details
```
GET /surveys/:id/marine-details
```

---

#### ➕ Add Marine Invoice
```
POST /surveys/:id/marine-details/invoices
```
**Request Body:**
```json
{
  "invoice_number": "INV-2025-001",
  "invoice_date": "2025-12-01",
  "invoice_amount": 50000.00
}
```

---

#### ➕ Add GR Entry
```
POST /surveys/:id/marine-details/gr-entries
```
**Request Body:**
```json
{
  "gr_number": "GR-2025-001",
  "gr_date": "2025-12-01"
}
```

---

### 5.3 Investigation Details

#### ➕ Add Investigation Details
```
POST /surveys/:id/investigation-details
```

**For Vehicle Loss:**
```json
{
  "loss_item_type": "vehicle",
  "vehicle_number": "DL01AB1234"
}
```

**For Cattle Loss:**
```json
{
  "loss_item_type": "cattle",
  "cattle_tag_number": "TAG-001",
  "cattle_name": "Shyama"
}
```

**For Human Loss:**
```json
{
  "loss_item_type": "human",
  "human_name": "Ramesh Kumar",
  "human_contact_number": "9876543210",
  "human_relation": "Brother"
}
```

**For Others:**
```json
{
  "loss_item_type": "others",
  "other_loss_item_name": "Jewelry items"
}
```

---

#### 👁️ Get Investigation Details
```
GET /surveys/:id/investigation-details
```

---

#### ✏️ Update Investigation Details
```
PUT /surveys/:id/investigation-details
```

---

## 5c. Survey Export & Main CM Sync *(v2 §5)*

> **The outbound push is STUBBED.** `cm_sync_enabled` defaults to `false`, so the composite
> PDF is generated and queued in `survey_export_documents` but nothing is sent until main
> ClaimsMitra publishes a contract. The admin UI states this rather than showing an error.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/admin/surveys/:id/timeline` | Canonical timeline — all milestones + full audit trail |
| GET | `/admin/surveys/:id/export` | Export state, readiness, staleness |
| POST | `/admin/surveys/:id/export` | Generate/regenerate (`{ force: true }` to override) |
| GET | `/admin/exports?sync_status=` | Outbox listing |
| POST | `/admin/exports/:id/push` | Retry a push (400 while sync is disabled) |

**Generated when** the invoice is `settled` **and** the report is `accepted`. Direct-assign
surveys need only the accepted report, since they are never billed.

**Regenerated when** `payload_hash` changes — a new report version, or media arriving late
from the mobile offline queue (which can flush days after the visit).

`GET /admin/surveys/:id/export` returns `not_ready_reason` when it cannot be generated yet,
and `stale: true` when the stored document predates the current data. `POST` returns
`warnings[]` listing media that could not be embedded — relevant because this is a record
document.

> The generated PDF lives at `/uploads/exports/<LAID>.pdf` on the **public** static mount.
> Only `/uploads/reports` is gated. If export documents should also be paywalled, they need
> the same treatment as reports.

**Timeline milestones** (always all of them; unreached ones have `at: null`):
`created`, `location_detected`, `assigned`, `in_transit`, `arrived`, `visit_completed`,
`report_submitted`, `finished`.

---

## 5b. Report Files *(v2 §4.4)* — ⚠️ BREAKING CHANGE

```
GET /api/v1/files/reports/:surveyId/:filename
Authorization: Bearer <token>
```

> ⚠️ **`/uploads/reports/...` now returns 403.** Report PDFs are no longer on the public
> static mount. Any client still building a report URL by stripping `/api/v1` off the API
> base will break.

Because the endpoint requires an `Authorization` header, a bare `<a href>` or `<Image src>`
will not work — fetch it as a blob and open the object URL (web), or pass `{ headers }` to
`FileSystem.downloadAsync` / the WebView source (mobile).

| Response | Meaning |
|---|---|
| `200` | The file |
| `402` `REPORT_PAYMENT_REQUIRED` | Balance outstanding on the invoice; `data.balance_due` and `data.invoice_number` included |
| `403` | Caller is not the owning assigner, the assigned surveyor, or an admin |
| `404` | Survey or report not found, or the file does not belong to that survey |

The paywall applies to the **assigner only**. Admins need it to do their job, and the
surveyor wrote it. Photos and documents are unaffected and stay on the static mount.

---

## 6. Public APIs

> **No Authentication Required**

### 6.1 Location (SMS Link)

#### 📍 Get Location Page
```
GET /public/location/:smsToken
```
Returns a simple HTML page for the contact person to share their location.

---

#### 📍 Submit Location
```
POST /public/location/:smsToken
```
**Request Body:**
```json
{
  "latitude": 28.6139,
  "longitude": 77.2090
}
```

---

### 6.2 QR Tracking

#### 📱 Track by QR Code
```
GET /public/track/:qrToken
```

**Expected Response (200):**
```json
{
  "success": true,
  "data": {
    "survey_id": 1,
    "status": "in_transit",
    "surveyor_name": "John Surveyor",
    "eta_minutes": 15,
    "current_location": {
      "latitude": 28.6200,
      "longitude": 77.2150
    }
  }
}
```

---

### 6.3 System

#### ❤️ Health Check
```
GET /public/health
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Server is running",
  "data": {
    "timestamp": "2025-12-06T12:32:15Z",
    "uptime": 3600
  }
}
```

---

#### ⚙️ Get App Config
```
GET /public/config/app
```

---

## 📁 Postman Collection Tips

### Environment Variables
Create a Postman environment with these variables:
```
base_url: http://localhost:3000/api/v1
admin_token: (set after admin login)
assigner_token: (set after assigner login)
surveyor_token: (set after surveyor login)
```

### Auto-save Token Script
Add this to the **Tests** tab of login requests:
```javascript
if (pm.response.code === 200) {
    const response = pm.response.json();
    pm.environment.set("admin_token", response.data.tokens.accessToken);
}
```

### Common Headers
- `Content-Type: application/json`
- `Authorization: Bearer {{admin_token}}`

---

## ❌ Common Error Responses

### 400 - Bad Request
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "phone", "message": "Phone must be 10 digits" }
  ]
}
```

### 401 - Unauthorized
```json
{
  "success": false,
  "message": "Invalid or expired token"
}
```

### 403 - Forbidden
```json
{
  "success": false,
  "message": "Access denied. Insufficient permissions."
}
```

### 404 - Not Found
```json
{
  "success": false,
  "message": "Resource not found"
}
```

### 500 - Server Error
```json
{
  "success": false,
  "message": "Internal server error"
}
```

---

## 📋 Survey Status Flow

```
pending → location_detected → assigned → in_transit → visit_completed → report_submitted → finished
                                                                       ↘ not_resolved (dispute)
```

| Status | Description | Who Changes |
|--------|-------------|-------------|
| `pending` | Survey created, awaiting location | System |
| `location_detected` | Location confirmed | System |
| `assigned` | Surveyor accepted with ETA | Surveyor |
| `in_transit` | Payment done, surveyor traveling | System |
| `visit_completed` | On-site inspection done | Surveyor |
| `report_submitted` | Report awaiting review | Surveyor |
| `finished` | Report accepted, payment released | Assigner |
| `not_resolved` | Dispute raised | Assigner/Surveyor |

---

**Document Version:** 1.0  
**Last Updated:** 2025-12-06  
**API Version:** v1
