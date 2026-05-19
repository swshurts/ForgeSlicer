# Auth Testing Playbook (Emergent Google Auth)

## Step 1: Create Test User & Session
```bash
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Backend API Tests
```bash
# /api/auth/me
curl -X GET "$REACT_APP_BACKEND_URL/api/auth/me" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# /api/me/designs - private library
curl -X GET "$REACT_APP_BACKEND_URL/api/me/designs" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# /api/me/components - private library
curl -X GET "$REACT_APP_BACKEND_URL/api/me/components" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

## Step 3: Browser Testing
```python
await page.context.add_cookies([{
    "name": "session_token",
    "value": "YOUR_SESSION_TOKEN",
    "domain": "your-app.com",
    "path": "/",
    "httpOnly": True,
    "secure": True,
    "sameSite": "None"
}])
await page.goto("https://your-app.com")
```

## Success Indicators
- ✅ /api/auth/me returns user data
- ✅ "My Designs" page loads private library
- ✅ Saved designs tied to user_id appear in /api/me/designs

## Failure Indicators
- ❌ "User not found" errors
- ❌ 401 Unauthorized when cookie present
- ❌ Free-text author still required on save dialog
