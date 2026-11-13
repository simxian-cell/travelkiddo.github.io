import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithRedirect, signOut } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, FieldPath, deleteField } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB2lxmS8vG6ojFG69Fe3rGwWKaeNt2uKGY",
  authDomain: "vacations-d1d71.firebaseapp.com",
  projectId: "vacations-d1d71",
  storageBucket: "vacations-d1d71.firebasestorage.app",
  messagingSenderId: "1011747961673",
  appId: "1:1011747961673:web:e3283422ccf1f77f3fb898",
  measurementId: "G-8F8MK029NK"
};

const TRIP_ID = "kyrgyzstan-2027";
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const tripRef = doc(db, "trips", TRIP_ID);
const plannerRef = doc(db, "trips", TRIP_ID, "shared", "planner");
const provider = new GoogleAuthProvider();
let unsubscribeTrip = null;
let unsubscribePlanner = null;
let currentUser = null;
let currentTrip = null;
let syncTimer = null;

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
function setStatus(message, ready = false) {
  $("collabStatus").textContent = message;
  $("collabDot").classList.toggle("ready", ready);
}
function stateSnapshot() {
  return window.getPlannerState?.();
}
function isOwner() { return currentTrip?.ownerUid === currentUser?.uid; }
function isMember(trip) { return trip && (trip.ownerUid === currentUser?.uid || Boolean(trip.members?.[currentUser?.uid])); }
function stopListeners() {
  unsubscribeTrip?.(); unsubscribePlanner?.();
  unsubscribeTrip = unsubscribePlanner = null;
}
function renderMembers() {
  const list = $("memberList");
  const members = currentTrip?.members || {};
  list.innerHTML = Object.entries(members).map(([uid, member]) => {
    const owner = uid === currentTrip.ownerUid;
    const remove = isOwner() && !owner ? `<button type="button" data-remove-uid="${encodeURIComponent(uid)}">Remove</button>` : "";
    return `<li><b>${owner ? "Owner" : "Editor"}</b> · ${escapeHtml(uid)}${remove}</li>`;
  }).join("") || "<li>No members yet.</li>";
  list.querySelectorAll("[data-remove-uid]").forEach(button => button.addEventListener("click", () => removeMember(decodeURIComponent(button.dataset.removeUid))));
  $("memberForm").hidden = !isOwner();
}
function renderAccount() {
  const signedIn = Boolean(currentUser);
  $("signInButton").hidden = signedIn;
  $("signOutButton").hidden = !signedIn;
  $("membersButton").hidden = !signedIn || !currentTrip;
  if (!signedIn) $("memberPanel").hidden = true;
}
async function ensureTrip() {
  const existing = await getDoc(tripRef);
  if (existing.exists()) return existing.data();
  await setDoc(tripRef, {
    title: "Kyrgyzstan Road Trip 2027",
    ownerUid: currentUser.uid,
    members: { [currentUser.uid]: { role: "owner", displayName: currentUser.displayName || "Owner" } },
    createdAt: serverTimestamp()
  });
  return (await getDoc(tripRef)).data();
}
function listenToTrip() {
  unsubscribeTrip = onSnapshot(tripRef, async snap => {
    if (!snap.exists()) {
      try { currentTrip = await ensureTrip(); renderAccount(); renderMembers(); setStatus("Trip created — sharing is ready", true); listenToPlanner(); }
      catch (error) { setStatus("Access setup is required — see deployment notes"); console.error(error); }
      return;
    }
    currentTrip = snap.data(); renderAccount(); renderMembers();
    if (!isMember(currentTrip)) { stopListeners(); setStatus("You are signed in, but have not been invited"); return; }
    setStatus(`Shared as ${currentUser.displayName || currentUser.email || "member"}`, true);
    if (!unsubscribePlanner) listenToPlanner();
  }, error => { setStatus("Could not read the trip — check your invitation"); console.error(error); });
}
function listenToPlanner() {
  unsubscribePlanner = onSnapshot(plannerRef, async snap => {
    if (!snap.exists()) { window.syncPlanner?.(true); return; }
    const state = snap.data().state;
    if (state?.days) window.dispatchEvent(new CustomEvent("planner-state", { detail: state }));
  }, error => { setStatus("Live updates are unavailable"); console.error(error); });
}
window.syncPlanner = function syncPlanner(immediate = false) {
  if (!currentUser || !isMember(currentTrip)) return;
  clearTimeout(syncTimer);
  const write = () => setDoc(plannerRef, { state: stateSnapshot(), updatedAt: serverTimestamp(), updatedBy: currentUser.uid }, { merge: true })
    .catch(error => { setStatus("Could not save a shared change"); console.error(error); });
  if (immediate) write(); else syncTimer = setTimeout(write, 550);
};
async function inviteMember() {
  const uid = $("memberUid").value.trim();
  if (!uid || !isOwner()) return;
  await updateDoc(tripRef, new FieldPath("members", uid), { role: "editor" });
  $("memberUid").value = "";
}
async function removeMember(uid) {
  if (!isOwner() || uid === currentTrip.ownerUid) return;
  await updateDoc(tripRef, new FieldPath("members", uid), deleteField());
}

$("signInButton").addEventListener("click", () => signInWithRedirect(auth, provider));
$("signOutButton").addEventListener("click", () => signOut(auth));
$("membersButton").addEventListener("click", () => { $("memberPanel").hidden = !$("memberPanel").hidden; });
$("inviteButton").addEventListener("click", () => inviteMember().catch(error => { setStatus("Could not invite that user ID"); console.error(error); }));
onAuthStateChanged(auth, user => {
  stopListeners(); currentUser = user; currentTrip = null; renderAccount();
  if (!user) { setStatus("Sign in to collaborate"); return; }
  setStatus(`Signed in as ${user.displayName || user.email}. Your ID: ${user.uid}`);
  listenToTrip();
});
