/**
 * Class Approval Handler
 * Listens for student join requests and allows teachers to approve/reject them.
 */

(function () {
    'use strict';

    // Queue of pending requests to show
    const requestQueue = [];
    let isPopupVisible = false;

    async function initClassApprovalListener() {
        console.log('[ClassApproval] Initializing listener...');

        // Check dependencies
        if (!window.auth || !window.db) {
            console.warn('[ClassApproval] Auth or DB not available yet. Retrying in 1s...');
            setTimeout(initClassApprovalListener, 1000);
            return;
        }

        // Wait for auth state
        window.auth.onAuthStateChanged(async (user) => {
            if (!user) {
                console.log('[ClassApproval] No user logged in.');
                return;
            }

            try {
                // Check Custom Claims for role
                const tokenResult = await user.getIdTokenResult();
                const claims = tokenResult.claims || {};
                const role = claims.role || claims.accessLevel; // Adjust based on your claims structure

                // Allow teacher, admin, owner
                const isAuthorized = claims.admin || claims.owner || claims.teacher ||
                    role === 'teacher' || role === 'admin' || role === 'owner';

                console.log('[ClassApproval] User role check:', { uid: user.uid, claims, isAuthorized });

                if (!isAuthorized) {
                    return;
                }

                // Start Listening
                startListening(user.uid);

            } catch (e) {
                console.error('[ClassApproval] Error checking claims:', e);
            }
        });
    }

    function startListening(teacherUid) {
        if (!window.firestoreCollection || !window.firestoreQuery || !window.firestoreOnSnapshot || !window.firestoreWhere) {
            console.error('[ClassApproval] Firestore helpers missing.');
            return;
        }

        console.log('[ClassApproval] Listening for requests for teacher:', teacherUid);

        const requestsRef = window.firestoreCollection(window.db, 'joinRequests');
        const q = window.firestoreQuery(requestsRef,
            window.firestoreWhere('teacherUid', '==', teacherUid),
            window.firestoreWhere('status', '==', 'pending')
        );

        window.firestoreOnSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    const req = { id: change.doc.id, ...data };
                    console.log('[ClassApproval] New request received:', req);
                    enqueueRequest(req);
                }
            });
        });
    }

    function enqueueRequest(req) {
        // Avoid duplicates
        if (requestQueue.find(r => r.id === req.id)) return;

        requestQueue.push(req);
        processQueue();
    }

    function processQueue() {
        if (isPopupVisible || requestQueue.length === 0) return;

        const req = requestQueue[0]; // Peek
        showApprovalPopup(req);
    }

    function showApprovalPopup(req) {
        isPopupVisible = true;

        // Inject CSS if needed
        if (!document.getElementById('class-approval-styles')) {
            const style = document.createElement('style');
            style.id = 'class-approval-styles';
            style.textContent = `
        .approval-overlay {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: #00000099; z-index: 10001;
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(5px);
        }
        .approval-card {
          background: #1e1e1e; color: #fff; padding: 24px; border-radius: 16px;
          width: 90%; max-width: 400px; box-shadow: 0 4px 20px #00000080;
          text-align: center; border: 1px solid #333;
        }
        .approval-title { margin-top: 0; font-size: 20px; font-weight: 600; }
        .approval-text { color: #ccc; margin: 16px 0; line-height: 1.5; }
        .approval-actions { display: flex; gap: 12px; justify-content: center; margin-top: 24px; }
        .approval-btn { padding: 10px 20px; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; transition: 0.2s; }
        .btn-approve { background: #4caf50; color: white; }
        .btn-approve:hover { background: #43a047; }
        .btn-reject { background: transparent; border: 1px solid #ef5350; color: #ef5350; }
        .btn-reject:hover { background: #EF53501A; }
      `;
            document.head.appendChild(style);
        }

        const overlay = document.createElement('div');
        overlay.className = 'approval-overlay';
        overlay.innerHTML = `
      <div class="approval-card">
        <h3 class="approval-title">Csatlakozási Kérelem</h3>
        <p class="approval-text">
          <strong>${escapeHtml(req.requesterName)}</strong> szeretne csatlakozni a(z) <br>
          <span style="color: #4caf50;">${escapeHtml(req.className)}</span> osztályhoz.
        </p>
        <div class="approval-actions">
          <button class="approval-btn btn-reject" id="btn-reject-${req.id}">Elutasítás</button>
          <button class="approval-btn btn-approve" id="btn-approve-${req.id}">Elfogadás</button>
        </div>
      </div>
    `;

        document.body.appendChild(overlay);

        document.getElementById(`btn-approve-${req.id}`).onclick = () => handleDecision(req, 'approved', overlay);
        document.getElementById(`btn-reject-${req.id}`).onclick = () => handleDecision(req, 'rejected', overlay);
    }

    async function handleDecision(req, decision, overlay) {
        try {
            console.log(`[ClassApproval] Processing decision: ${decision} for ${req.id}`);

            // Use Cloud Function for secure approval/rejection
            const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");
            // Reuse existing app or auth.app if available, else undefined (default app)
            const app = window.firebaseApp || (window.auth ? window.auth.app : undefined);
            const functions = getFunctions(app, 'europe-west1');
            const approveJoinRequest = httpsCallable(functions, 'approveJoinRequest');

            // Call function
            await approveJoinRequest({
                requestId: req.id,
                decision: decision
            });

            console.log(`[ClassApproval] Request ${req.id} ${decision} successfully via Cloud Function.`);

        } catch (e) {
            console.error('[ClassApproval] Error processing decision:', e);
            alert('Hiba történt a feldolgozás során: ' + (e.message || 'Ismeretlen hiba'));
        } finally {
            requestQueue.shift(); // Remove processed
            if (document.body.contains(overlay)) {
                document.body.removeChild(overlay);
            }
            isPopupVisible = false;
            processQueue(); // Next
        }
    }

    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initClassApprovalListener);
    } else {
        initClassApprovalListener();
    }

})();
