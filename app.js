// dVoting — real-time P2P voting on GenosDB, with cryptographic one-vote-per-identity.
//
// What this example demonstrates, end to end:
//   • Votes as signed nodes with a DETERMINISTIC id (`vote:<session>:<address>`):
//     one identity = one vote by construction — voting again OVERWRITES your own
//     vote (changing your mind is allowed until the poll closes), and tallies are
//     a live COUNT of vote nodes, immune to the lost-update problem of counters.
//   • Zero-trust + Governance: visitors watch results as read-only guests; public
//     rules promote them to `voter` (~10 s) and `admin` (moderation) while a
//     superadmin is online. Even the right to vote is earned.
//   • ACLs: polls belong to their creator; your vote node belongs to you.
//   • GenosDB Design Guide: tokens, dark theme, identity in a centered <dialog>,
//     session top-right as `0x… [role]`, toasts instead of alerts.
import { gdb } from "https://cdn.jsdelivr.net/npm/genosdb@latest/dist/index.min.js"

// ============================== Configuration ==============================

const DB_NAME = "dvoting" // database name = P2P room name

// Demo superadmin — SHOWCASE ONLY. Its mnemonic is public so any visitor can
// run the governance engine. Replace both for a real deployment.
const DEMO_SUPERADMIN = {
  address: "0xbfDe0eCEC5332Fd86D2570085571D6051Df098dA",
  mnemonic: "panic now afford carbon donate lecture drift excite collect essay stuff prosper",
}

// Custom RBAC roles. Writing — and therefore VOTING — must be earned.
const ROLES = {
  superadmin: { can: ["assignRole"], inherits: ["admin"] }, // signs promotions
  admin: { can: ["delete", "deleteAny"], inherits: ["voter"] }, // moderates spam polls
  voter: { can: ["write", "link", "sync"], inherits: ["guest"] }, // votes & creates polls
  guest: { can: ["read", "sync"] }, // watches results only
}

// Public advancement rules (last-match-wins, low demo thresholds).
const MEMBER = { $in: ["voter", "admin"] }
const GOVERNANCE_RULES = [
  { if: { role: "guest" }, offsetTimestamp: 10000, then: { assignRole: "voter" } }, // onboarding gate
  { if: { role: MEMBER }, then: { assignRole: "voter" } }, // floor
  { if: { role: MEMBER, pollsCreated: { $gte: 2 } }, then: { assignRole: "admin" } }, // climb
]

// ================================ Database =================================

const db = await gdb(DB_NAME, {
  rtc: true, // required by the Security Manager
  sm: {
    superAdmins: [DEMO_SUPERADMIN.address],
    customRoles: ROLES,
    governanceRules: GOVERNANCE_RULES,
    acls: true, // polls belong to creators; votes belong to voters
  },
})
globalThis.db = db // console handle (matches the official examples)

// ================================ Helpers ==================================

const $ = (id) => document.getElementById(id)

/** Escape untrusted text before inserting it into HTML (peers write it). */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))

const toast = (msg, isError = false) => {
  const el = $("toast")
  el.textContent = msg
  el.className = `toast show${isError ? " error" : ""}`
  clearTimeout(toast._t)
  toast._t = setTimeout(() => (el.className = "toast"), 3200)
}

const fmtLeft = (ms) => {
  const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000 % 24),
        m = Math.floor(ms / 60000 % 60), s = Math.floor(ms / 1000 % 60)
  return `${d}d ${h}h ${m}m ${s}s`
}

/** A poll's liveness is DERIVED from endTime — no peer ever needs write
 *  access to "close" someone else's poll (ACLs would rightly refuse). */
const isOpen = (session) => session.endTime > Date.now()

// =============================== Identity ==================================

let myAddress = null
let myRole = null
let unsubRole = null

const can = (permission) => {
  let role = myRole
  while (role && ROLES[role]) {
    if (ROLES[role].can.includes(permission)) return true
    role = ROLES[role].inherits?.[0]
  }
  return false
}

const applyPermissionsToUI = () => {
  $("newPollBtn").style.display = can("write") ? "block" : "none"
  $("voterHint").style.display = myAddress && !can("write") ? "block" : "none"
  renderPoll() // vote buttons + delete affordances depend on the live role
}

db.sm.setSecurityStateChangeCallback((state) => {
  if (state.isActive) {
    myAddress = state.activeAddress
    $("identityModal").close()
    $("identityPanel").style.display = "none"
    $("sessionBar").style.display = "flex"
    $("whoami").textContent = state.abbrAddr
    watchMyRole()
  } else {
    unsubRole?.(); unsubRole = null
    myAddress = myRole = null
    $("sessionBar").style.display = "none"
    $("identityPanel").style.display = "block"
    $("mnemonicBox").readOnly = false
    $("generateBtn").style.display = "inline-block"
    $("protectBtn").style.display = "none"
    $("webauthnLoginBtn").style.display = db.sm.hasExistingWebAuthnRegistration() ? "inline-block" : "none"
    queueMicrotask(() => applyPermissionsToUI())
  }
})

const watchMyRole = async () => {
  unsubRole?.()
  const { unsubscribe } = await db.get(`user:${myAddress}`, (node) => {
    const next = node?.value?.role ?? "guest"
    if (next !== myRole) {
      myRole = next
      $("myRole").textContent = myRole
      $("myRole").dataset.role = myRole
      applyPermissionsToUI()
    }
  })
  unsubRole = unsubscribe
}

// --- Identity modal (three-phase state machine, see the Design Guide) ---

$("openLoginBtn").onclick = () => $("identityModal").showModal()
$("closeModalBtn").onclick = () => $("identityModal").close()
$("identityModal").onclick = (e) => { if (e.target === $("identityModal")) $("identityModal").close() }

$("generateBtn").onclick = async () => {
  const identity = await db.sm.startNewUserRegistration()
  if (!identity) return toast("Could not generate an identity", true)
  const box = $("mnemonicBox")
  box.value = identity.mnemonic
  box.readOnly = true
  $("generateBtn").style.display = "none"
  $("protectBtn").style.display = "inline-block"
  toast("SAVE THIS PHRASE — it is your only way back into this identity")
}

$("copyBtn").onclick = async () => {
  const phrase = $("mnemonicBox").value.trim()
  if (!phrase) return
  await navigator.clipboard.writeText(phrase)
  toast("Phrase copied to clipboard")
}

$("loginBtn").onclick = async () => {
  const phrase = $("mnemonicBox").value.trim()
  if (!phrase) return toast("Paste (or generate) a mnemonic first", true)
  const identity = await db.sm.loginOrRecoverUserWithMnemonic(phrase)
  identity ? toast(`Welcome ${db.sm.abbrAddr(identity.address)}`) : toast("Login failed", true)
}

$("protectBtn").onclick = async () => {
  const address = await db.sm.protectCurrentIdentityWithWebAuthn()
  address ? toast("Identity protected with a passkey") : toast("Passkey protection failed (HTTPS required)", true)
}

$("webauthnLoginBtn").onclick = async () => {
  const address = await db.sm.loginCurrentUserWithWebAuthn()
  if (!address) toast("Passkey login failed", true)
}

$("superadminBtn").onclick = () => db.sm.loginOrRecoverUserWithMnemonic(DEMO_SUPERADMIN.mnemonic)
$("logoutBtn").onclick = () => db.sm.clearSecurity()

// ======================== Poll creation (creator view) =====================

let draftProposals = []

const renderDraftProposals = () => {
  const list = $("proposalsDraftList")
  list.innerHTML = draftProposals.length ? "" : '<p class="empty-hint">No proposals added yet — add at least two.</p>'
  draftProposals.forEach((title, i) => {
    const row = document.createElement("div")
    row.className = "draft-row"
    row.innerHTML = `<span>${esc(title)}</span><button aria-label="Remove proposal">×</button>`
    row.querySelector("button").onclick = () => { draftProposals.splice(i, 1); renderDraftProposals() }
    list.appendChild(row)
  })
}

$("addProposalBtn").onclick = () => {
  const title = $("newProposalInput").value.trim()
  if (!title) return toast("Proposal title cannot be empty", true)
  if (draftProposals.includes(title)) return toast("This proposal already exists", true)
  if (draftProposals.length >= 10) return toast("Maximum of 10 proposals", true)
  draftProposals.push(title)
  $("newProposalInput").value = ""
  $("newProposalInput").focus()
  renderDraftProposals()
}
$("newProposalInput").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("addProposalBtn").click() } }

const setDefaultEndTime = () => {
  const t = new Date(Date.now() + 26 * 3600000) // tomorrow +2h
  t.setMinutes(0, 0, 0)
  $("endTimeInput").value = t.toISOString().slice(0, 16)
}

const resetCreatorForm = () => {
  $("pollNameInput").value = ""
  $("newProposalInput").value = ""
  draftProposals = []
  renderDraftProposals()
  setDefaultEndTime()
  $("shareLinkBox").style.display = "none"
}

$("createPollBtn").onclick = async () => {
  const name = $("pollNameInput").value.trim()
  if (!name) return toast("Please enter a name for the poll", true)
  if (draftProposals.length < 2) return toast("Add at least two proposal options", true)
  const endTime = new Date($("endTimeInput").value).getTime()
  if (isNaN(endTime) || endTime <= Date.now() + 60000) return toast("End time must be at least 1 minute in the future", true)

  try {
    await db.sm.executeWithPermission("write") // guests can't create polls

    // The poll and its proposals are ACL-owned by the creator.
    const sessionId = await db.sm.acls.set({
      type: "votingSession", name, endTime, owner: myAddress, createdAt: Date.now(),
    })
    for (let i = 0; i < draftProposals.length; i++) {
      await db.sm.acls.set({ type: "proposal", sessionId, title: draftProposals[i], originalIndex: i })
    }
    await bumpPollsCreated() // governance metric on my user node

    const url = `${location.origin}${location.pathname}#${sessionId}`
    $("shareLink").href = url
    $("shareLink").textContent = url
    $("shareLinkBox").style.display = "block"
    toast("Poll created — share the link!")
  } catch (err) {
    toast(err.message, true)
  }
}

/** Aggregate the governance metric (spread keeps `role` intact!). */
const bumpPollsCreated = async () => {
  const id = `user:${myAddress}`
  const { result } = await db.get(id)
  await db.put({ ...result.value, pollsCreated: (result.value.pollsCreated ?? 0) + 1 }, id)
}

// ====================== Active polls (sidebar navigation) ==================

const timers = {} // countdown intervals, keyed by element id

const tick = (key, el, endTime, prefix = "") => {
  clearInterval(timers[key])
  const update = () => {
    if (!document.body.contains(el)) return clearInterval(timers[key])
    const left = endTime - Date.now()
    el.textContent = left <= 0 ? "Finished" : prefix + fmtLeft(left) + (prefix ? "" : " left")
    if (left <= 0) { clearInterval(timers[key]); renderPoll() } // derive "ended" — no write needed
  }
  update()
  timers[key] = setInterval(update, 1000)
}

let sessions = new Map() // id → session value (fed by the live subscription)

const renderSessionsList = () => {
  const list = $("activePollsList")
  const open = [...sessions.entries()].filter(([, s]) => isOpen(s))
    .sort((a, b) => b[1].createdAt - a[1].createdAt)
  list.innerHTML = open.length ? "" : '<p class="empty-hint">No active polls right now.</p>'

  for (const [id, s] of open) {
    const item = document.createElement("div")
    item.className = "poll-item" + (id === currentSessionId ? " selected" : "")
    item.innerHTML = `
      <div class="poll-item-info">
        <h4>${esc(s.name)}</h4>
        <span class="countdown-small" id="cd-${id}"></span>
      </div>
      ${(myAddress && (s.owner === myAddress || can("deleteAny"))) ? '<button class="poll-delete" title="Delete poll">×</button>' : ""}`
    item.querySelector(".poll-item-info").onclick = () => { location.hash = id }
    item.querySelector(".poll-delete")?.addEventListener("click", (e) => {
      e.stopPropagation()
      deletePoll(id, s.name)
    })
    list.appendChild(item)
    tick(`cd-${id}`, item.querySelector(`[id="cd-${id}"]`), s.endTime)
  }
}

// ONE live subscription keeps the sessions map fresh (all four actions).
db.map({ query: { type: "votingSession" } }, ({ id, value, action }) => {
  if (action === "removed") sessions.delete(id)
  else sessions.set(id, value)
  renderSessionsList()
  if (id === currentSessionId) action === "removed" ? (location.hash = "") : renderPollHeader()
})

const deletePoll = async (sessionId, name) => {
  if (!confirm(`Delete the poll "${name}"? This cannot be undone.`)) return
  try {
    await db.sm.executeWithPermission("delete")
    const { results: proposals } = await db.map({ query: { type: "proposal", sessionId }, realtime: false })
    const { results: votes } = await db.map({ query: { type: "vote", sessionId }, realtime: false })
    await Promise.all([...proposals, ...votes].map((n) => db.remove(n.id)))
    await db.remove(sessionId)
    toast(`Poll "${name}" deleted`)
  } catch (err) {
    toast(err.message, true)
  }
}

// ========================= Poll view (voting & tally) ======================
// Tallies are a COUNT over vote nodes — one node per voter per session, with
// the deterministic id `vote:<sessionId>:<address>`. Re-voting overwrites
// your own node (allowed while the poll is open); counters can't lose votes.

let currentSessionId = null
let unsubProposals = null
let unsubVotes = null
let proposals = new Map() // id → proposal value
let votes = new Map() // voter address → proposalId

const voteId = (sessionId, address) => `vote:${sessionId}:${address}`

const renderPollHeader = () => {
  const s = sessions.get(currentSessionId)
  if (!s) return
  $("pollTitle").textContent = s.name
  $("pollMeta").textContent = `by ${s.owner ? db.sm.abbrAddr(s.owner) : "unknown"} · closes ${new Date(s.endTime).toLocaleString()}`
  tick("cd-main", $("countdown"), s.endTime, "Time remaining: ")
}

const renderPoll = () => {
  if (!currentSessionId) return
  const s = sessions.get(currentSessionId)
  if (!s) return
  const open = isOpen(s)
  const myVote = myAddress ? votes.get(myAddress) : null

  // tally: count votes per proposal
  const tally = {}
  for (const proposalId of votes.values()) tally[proposalId] = (tally[proposalId] ?? 0) + 1
  const totalVotes = votes.size
  const maxVotes = Math.max(0, ...Object.values(tally))

  const list = $("proposalsList")
  list.innerHTML = ""
  const ordered = [...proposals.entries()].sort((a, b) => a[1].originalIndex - b[1].originalIndex)
  if (!ordered.length) {
    list.innerHTML = '<p class="empty-hint">No proposals in this poll.</p>'
    return
  }

  for (const [pid, p] of ordered) {
    const count = tally[pid] ?? 0
    const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0
    const row = document.createElement("div")
    row.className = "proposal" + (myVote === pid ? " mine" : "")
    row.innerHTML = `
      <div class="proposal-head">
        <h3>${esc(p.title)}</h3>
        <span class="proposal-count mono">${count} vote${count === 1 ? "" : "s"} · ${pct}%</span>
      </div>
      <div class="tally-track"><div class="tally-fill" style="width:${pct}%"></div></div>
      ${open ? `<button class="vote-btn" ${!can("write") ? "disabled" : ""}>${myVote === pid ? "Your vote ✓ " : myVote ? "Change vote to this" : "Vote"}</button>` : ""}`
    row.querySelector(".vote-btn")?.addEventListener("click", () => castVote(pid))
    list.appendChild(row)
  }

  // winner banner for closed polls
  const banner = $("winnerBanner")
  if (!open && totalVotes > 0) {
    const winners = ordered.filter(([pid]) => (tally[pid] ?? 0) === maxVotes)
    banner.textContent = winners.length === 1
      ? `🏆 WINNER: "${winners[0][1].title}" (${maxVotes} vote${maxVotes === 1 ? "" : "s"})`
      : `🏆 TIE (${maxVotes} votes): ${winners.map(([, w]) => `"${w.title}"`).join(", ")}`
    banner.style.display = "block"
  } else if (!open) {
    banner.textContent = "Poll ended — no votes were cast."
    banner.style.display = "block"
  } else {
    banner.style.display = "none"
  }

  // voting hint for guests
  $("guestVoteHint").style.display = open && myAddress && !can("write") ? "block" : "none"
  $("signinVoteHint").style.display = open && !myAddress ? "block" : "none"
}

const castVote = async (proposalId) => {
  const s = sessions.get(currentSessionId)
  if (!s || !isOpen(s)) return toast("This poll has closed", true)
  try {
    await db.sm.executeWithPermission("write") // the right to vote is earned
    // Deterministic id: one vote node per identity per poll. Voting again
    // overwrites — the tally can never double-count an identity.
    await db.sm.acls.set(
      { type: "vote", sessionId: currentSessionId, proposalId, voter: myAddress, at: Date.now() },
      voteId(currentSessionId, myAddress),
    )
    toast(votes.get(myAddress) ? "Vote changed" : "Vote cast")
  } catch (err) {
    toast(err.message, true)
  }
}

const openPoll = async (sessionId) => {
  currentSessionId = sessionId
  unsubProposals?.(); unsubVotes?.()
  proposals = new Map(); votes = new Map()
  $("creatorSection").style.display = "none"
  $("pollSection").style.display = "block"
  renderSessionsList() // highlight selection

  const { result } = await db.get(sessionId)
  if (!result || result.value?.type !== "votingSession") {
    toast("Poll not found", true)
    location.hash = ""
    return
  }
  sessions.set(sessionId, result.value)
  renderPollHeader()

  // Live proposals + live votes → every peer's tally updates in real time.
  ;({ unsubscribe: unsubProposals } = await db.map(
    { query: { type: "proposal", sessionId } },
    ({ id, value, action }) => {
      action === "removed" ? proposals.delete(id) : proposals.set(id, value)
      renderPoll()
    },
  ))
  ;({ unsubscribe: unsubVotes } = await db.map(
    { query: { type: "vote", sessionId } },
    ({ value, action }) => {
      if (action === "removed") votes.delete(value?.voter)
      else if (value?.voter) votes.set(value.voter, value.proposalId)
      renderPoll()
    },
  ))
}

// ================================ Routing ==================================

const showCreator = () => {
  currentSessionId = null
  unsubProposals?.(); unsubVotes?.()
  $("pollSection").style.display = "none"
  $("creatorSection").style.display = "block"
  renderSessionsList()
  resetCreatorForm()
}

const route = () => {
  const hash = location.hash.slice(1)
  hash ? openPoll(hash) : showCreator()
}

$("newPollBtn").onclick = () => { location.hash = "" ; showCreator() }
addEventListener("hashchange", route)
addEventListener("beforeunload", () => db.room?.leave?.()) // real unload only — never pagehide

// ================================= Boot ====================================

applyPermissionsToUI()
renderDraftProposals()
setDefaultEndTime()
route()
