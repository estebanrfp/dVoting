import { gdb } from "https://cdn.jsdelivr.net/npm/genosdb@latest/dist/index.min.js";

const db = await gdb("voting-app-v10-db", { rtc: true }); // Migrated to async factory

// UI Elements
const creatorView = document.getElementById("creatorView");
const pollNameInput = document.getElementById("pollNameInput");
const newProposalInput = document.getElementById("newProposalInput");
const addProposalBtn = document.getElementById("addProposalBtn");
const proposalsInteractiveListDiv = document.getElementById("proposalsInteractiveList");
const endTimeInputCreator = document.getElementById("endTimeInputCreator");
const createPollBtn = document.getElementById("createPollBtn");
const creatorStatus = document.getElementById("creatorStatus");
const shareLinkContainer = document.getElementById("shareLinkContainer");
const shareLinkWrapper = document.getElementById("shareLinkContainerWrapper");
const shareLink = document.getElementById("shareLink");
const showVotingViewBtn = document.getElementById("showVotingViewBtn");

const votingView = document.getElementById("votingView");
const showCreatorViewBtn = document.getElementById("showCreatorViewBtn");
const votingSessionTitle = document.getElementById("votingSessionTitle");
const countdownDisplay = document.getElementById("countdown");
const proposalsListDiv = document.getElementById("proposalsList");
const winnerMessageDiv = document.getElementById("winnerMessage");
const votingStatus = document.getElementById("votingStatus");
const activeVotingsListItemsDiv = document.getElementById("activeVotingsListItems");

let currentSessionId = null;
let proposalsUnsubscribe = null;
let sessionsListenerUnsubscribe = null;
const countdownIntervals = {};
let currentProposalsArray = [];

// Set default end time (tomorrow, 2 hours ahead)
const setDefaultEndTime = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(tomorrow.getHours() + 2, 0, 0, 0);
  if (endTimeInputCreator) endTimeInputCreator.value = tomorrow.toISOString().slice(0, 16);
};

// Show status messages in the UI
const setStatus = (element, message, type = "info") => {
  if (element) {
    element.textContent = message;
    element.className = `status-message ${type}`;
    const displayStyle = message ? 'block' : 'none';
    element.style.display = displayStyle;

    if (element.id === 'creatorStatus') {
      if (shareLinkWrapper) {
        if (message || (shareLinkContainer && !shareLinkContainer.classList.contains('hidden'))) {
          shareLinkWrapper.style.visibility = 'visible';
        } else {
          shareLinkWrapper.style.visibility = 'hidden';
        }
      }
    }
  }
};

if (showCreatorViewBtn) {
  showCreatorViewBtn.onclick = () => {
    if (votingView) votingView.classList.add('hidden');
    if (creatorView) creatorView.classList.remove('hidden');
    window.location.hash = "";
    resetCreatorForm();
  };
}
if (showVotingViewBtn) {
  showVotingViewBtn.onclick = () => {
    if (creatorView) creatorView.classList.add('hidden');
    if (votingView) votingView.classList.remove('hidden');
  };
}

// Render interactive proposals in creator view
const renderInteractiveProposals = () => {
  if (!proposalsInteractiveListDiv) return;
  proposalsInteractiveListDiv.innerHTML = "";
  if (currentProposalsArray.length === 0) {
    proposalsInteractiveListDiv.innerHTML = `<p style="text-align:center; color:#6c757d; margin-top:10px;">No proposals added yet.</p>`;
    return;
  }
  currentProposalsArray.forEach((proposalTitle, index) => {
    const item = document.createElement("div");
    item.className = "proposal-interactive-item";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = proposalTitle;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.onclick = () => {
      currentProposalsArray.splice(index, 1);
      renderInteractiveProposals();
    };
    item.append(titleSpan, removeBtn);
    proposalsInteractiveListDiv.appendChild(item);
  });
};

if (addProposalBtn) {
  addProposalBtn.onclick = () => {
    const proposalTitle = newProposalInput.value.trim();
    if (proposalTitle) {
      if (currentProposalsArray.includes(proposalTitle)) {
        setStatus(creatorStatus, "This proposal already exists.", "error"); return;
      }
      if (currentProposalsArray.length >= 10) {
        setStatus(creatorStatus, "Maximum of 10 proposals allowed.", "error"); return;
      }
      currentProposalsArray.push(proposalTitle);
      newProposalInput.value = "";
      renderInteractiveProposals();
      setStatus(creatorStatus, "", "info");
    } else {
      setStatus(creatorStatus, "Proposal title cannot be empty.", "error");
    }
    newProposalInput.focus();
  };
}
if (newProposalInput) {
  newProposalInput.onkeypress = (e) => { if (e.key === 'Enter') { e.preventDefault(); addProposalBtn.click(); } };
}

// Reset creator form
const resetCreatorForm = () => {
  if (pollNameInput) pollNameInput.value = "";
  currentProposalsArray = [];
  renderInteractiveProposals();
  setDefaultEndTime();
  if (shareLinkContainer) shareLinkContainer.classList.add("hidden");
  if (shareLinkWrapper) shareLinkWrapper.style.visibility = 'hidden';
  setStatus(creatorStatus, "", "info");
  if (newProposalInput) newProposalInput.value = "";
};

if (createPollBtn) {
  createPollBtn.onclick = async () => {
    setStatus(creatorStatus, "", "info");
    if (shareLinkContainer) shareLinkContainer.classList.add("hidden");
    if (shareLinkWrapper) shareLinkWrapper.style.visibility = 'hidden';

    const pollNameValue = pollNameInput ? pollNameInput.value.trim() : "";
    if (!pollNameValue) return setStatus(creatorStatus, "Please enter a name for the poll.", "error");
    if (currentProposalsArray.length < 2) return setStatus(creatorStatus, "Please add at least two proposal options.", "error");

    if (!endTimeInputCreator || !endTimeInputCreator.value) return setStatus(creatorStatus, "Select an end date and time.", "error");
    const endTime = new Date(endTimeInputCreator.value).getTime();
    if (isNaN(endTime) || endTime <= Date.now() + 60000) return setStatus(creatorStatus, "End date must be at least 1 minute in the future.", "error");

    createPollBtn.disabled = true;
    setStatus(creatorStatus, "Creating poll...", "info");
    try {
      const sessionId = await db.put({ type: "votingSession", name: pollNameValue, endTime, status: "active", createdAt: Date.now() });
      for (let i = 0; i < currentProposalsArray.length; i++) {
        await db.put({ type: "proposal", sessionId, title: currentProposalsArray[i], votes: 0, originalIndex: i });
      }
      const linkUrl = `${window.location.origin}${window.location.pathname}#${sessionId}`;
      if (shareLink) { shareLink.href = linkUrl; shareLink.textContent = linkUrl; }

      setStatus(creatorStatus, "Poll created successfully! Link generated below.", "success");
      if (shareLinkContainer) shareLinkContainer.classList.remove("hidden");
      if (shareLinkWrapper) shareLinkWrapper.style.visibility = 'visible';

    } catch (e) { setStatus(creatorStatus, `Error creating poll: ${e.message}`, "error"); }
    finally { createPollBtn.disabled = false; }
  };
}

// Delete a voting session and its proposals
const handleDeleteVotingSession = async (sessionId, sessionName) => {
  if (!confirm(`Are you sure you want to delete the poll "${sessionName}"? This action cannot be undone.`)) {
    return;
  }
  setStatus(votingStatus, `Deleting poll "${sessionName}"...`, "info");
  try {
    const { results: proposalsNodesToDelete } = await db.map({
      query: { type: "proposal", sessionId: sessionId },
      realtime: false
    });
    const proposalDeletePromises = proposalsNodesToDelete.map(pNode => db.remove(pNode.id));
    await Promise.all(proposalDeletePromises);
    await db.remove(sessionId);

    if (currentSessionId === sessionId) {
      currentSessionId = null;
      if (votingSessionTitle) votingSessionTitle.textContent = "Select a Poll";
      if (countdownDisplay) countdownDisplay.textContent = "";
      if (proposalsListDiv) proposalsListDiv.innerHTML = "<p style='text-align:center'>The poll you were viewing has been deleted.</p>";
      if (winnerMessageDiv) winnerMessageDiv.classList.add("hidden");
      if (proposalsUnsubscribe) { proposalsUnsubscribe(); proposalsUnsubscribe = null; }
      setStatus(votingStatus, `Poll "${sessionName}" deleted successfully.`, "success");
      if (window.location.hash === `#${sessionId}`) window.location.hash = "";
    } else {
      setStatus(votingStatus, `Poll "${sessionName}" deleted successfully.`, "success");
    }
  } catch (error) {
    console.error("Error deleting voting session:", sessionId, error);
    setStatus(votingStatus, `Error deleting poll: ${error.message}`, "error");
  }
}

// Render the list of active votings
const renderActiveVotingsList = async () => {
  if (!activeVotingsListItemsDiv) return;
  const { results: allSessions } = await db.map({ query: { type: "votingSession" }, field: "createdAt", order: "desc" });
  activeVotingsListItemsDiv.innerHTML = "";
  const activeNowSessions = [];

  for (const sessionNode of allSessions) {
    const session = sessionNode.value;
    const sessionId = sessionNode.id;
    if (session.endTime <= Date.now() && session.status === 'active') {
      db.put({ ...session, status: "ended" }, sessionId).catch(err => console.warn("Error auto-ending session:", sessionId, err));
    } else if (session.status === 'active') {
      activeNowSessions.push(sessionNode);
    }
  }

  if (activeNowSessions.length === 0) {
    const p = document.createElement('p');
    p.textContent = "No active polls at the moment.";
    p.style.textAlign = "center"; p.style.opacity = "0.7";
    activeVotingsListItemsDiv.appendChild(p);
  } else {
    activeNowSessions.forEach(sessionNode => {
      const session = sessionNode.value;
      const sessionId = sessionNode.id;
      const itemDiv = document.createElement("div");
      itemDiv.className = "active-voting-item";
      itemDiv.dataset.sessionId = sessionId;
      if (sessionId === currentSessionId) itemDiv.classList.add("selected");

      const detailsDiv = document.createElement("div");
      detailsDiv.className = "active-voting-item-details";
      detailsDiv.onclick = () => { window.location.hash = sessionId; };

      const titleH4 = document.createElement("h4");
      titleH4.textContent = session.name || `Poll ${sessionId.substring(0, 6)}`;
      const countdownSmall = document.createElement("div");
      countdownSmall.className = "countdown-small";
      countdownSmall.id = `countdown-small-${sessionId}`;
      detailsDiv.append(titleH4, countdownSmall);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-session-btn";
      deleteBtn.innerHTML = "×";
      deleteBtn.title = "Delete Poll";
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        handleDeleteVotingSession(sessionId, session.name || `Poll ${sessionId.substring(0, 6)}`);
      };
      itemDiv.append(detailsDiv, deleteBtn);
      activeVotingsListItemsDiv.appendChild(itemDiv);
      startSmallCountdown(session.endTime, sessionId, countdownSmall);
    });
  }
}

// Start countdown for small poll items
const startSmallCountdown = (endTime, sessionId, element) => {
  const intervalKey = `small-${sessionId}`;
  if (countdownIntervals[intervalKey]) clearInterval(countdownIntervals[intervalKey]);
  function update() {
    if (!element || !document.body.contains(element)) { clearInterval(countdownIntervals[intervalKey]); delete countdownIntervals[intervalKey]; return; }
    const timeLeft = endTime - Date.now();
    if (timeLeft <= 0) {
      clearInterval(countdownIntervals[intervalKey]); delete countdownIntervals[intervalKey];
      element.textContent = "Finished"; return;
    }
    const d = Math.floor(timeLeft / (1000 * 60 * 60 * 24)), h = Math.floor(timeLeft / (1000 * 60 * 60) % 24), m = Math.floor(timeLeft / 60000 % 60), s = Math.floor(timeLeft / 1000 % 60);
    element.textContent = `${d}d ${h}h ${m}m ${s}s left`;
  }
  update(); countdownIntervals[intervalKey] = setInterval(update, 1000);
}

// Load a voting session and proposals
const loadVotingSession = async (sessionId) => {
  currentSessionId = sessionId;
  await renderActiveVotingsList();
  if (votingSessionTitle) votingSessionTitle.textContent = "Loading Poll...";
  if (countdownDisplay) countdownDisplay.textContent = "";
  if (proposalsListDiv) proposalsListDiv.innerHTML = "";
  if (winnerMessageDiv) winnerMessageDiv.classList.add("hidden");
  setStatus(votingStatus, "", "info");
  if (proposalsUnsubscribe) { proposalsUnsubscribe(); proposalsUnsubscribe = null; }

  try {
    const sessionNode = await db.get(sessionId);
    if (!sessionNode || !sessionNode.result || sessionNode.result.value.type !== "votingSession") {
      setStatus(votingStatus, "Poll not found or invalid.", "error");
      if (votingSessionTitle) votingSessionTitle.textContent = "Error Loading"; return;
    }
    const session = sessionNode.result.value;
    if (votingSessionTitle) votingSessionTitle.textContent = session.name;
    startMainCountdown(session.endTime, sessionId);
    const { unsubscribe } = await db.map(
      { query: { type: "proposal", sessionId: sessionId }, field: "originalIndex", order: "asc", realtime: true },
      () => updateProposalsUI(sessionId)
    );
    proposalsUnsubscribe = unsubscribe;
    await updateProposalsUI(sessionId);
  } catch (e) { setStatus(votingStatus, `Error loading poll: ${e.message}`, "error"); }
}

// Update proposals UI for a session
const updateProposalsUI = async (sessionIdToUpdate) => {
  if (!sessionIdToUpdate || !db) return;
  const sessionNode = await db.get(sessionIdToUpdate);
  if (!sessionNode || !sessionNode.result) return;
  const session = sessionNode.result.value;
  const isSessionActive = session.status === "active" && session.endTime > Date.now();
  const votedProposalIdInThisSession = localStorage.getItem(`voted_in_session_${sessionIdToUpdate}`);

  if (votingSessionTitle && votingSessionTitle.textContent !== session.name) votingSessionTitle.textContent = session.name;
  const { results: proposals } = await db.map({ query: { type: "proposal", sessionId: sessionIdToUpdate }, field: "originalIndex", order: "asc" });

  if (proposalsListDiv) proposalsListDiv.innerHTML = "";
  if (proposals.length === 0) {
    if (proposalsListDiv) proposalsListDiv.innerHTML = `<p style="text-align:center;">${isSessionActive ? "No proposals yet." : "No proposals in this poll."}</p>`;
  } else {
    proposals.forEach(pNode => {
      const proposal = pNode.value;
      const pId = pNode.id;
      const item = document.createElement("div"); item.className = "proposal-item";
      const titleEl = document.createElement("h3"); titleEl.textContent = proposal.title;
      const votesEl = document.createElement("p"); votesEl.className = "votes";
      votesEl.innerHTML = `Votes: <span id="votes-${pId}">${proposal.votes || 0}</span>`;
      const voteBtn = document.createElement("button");
      if (votedProposalIdInThisSession) {
        voteBtn.disabled = true;
        if (votedProposalIdInThisSession === pId) { voteBtn.textContent = "Your Vote ✔️"; voteBtn.classList.add("voted-for"); }
        else { voteBtn.textContent = "Vote"; }
      } else { voteBtn.textContent = "Vote"; voteBtn.disabled = !isSessionActive; }
      voteBtn.onclick = (event) => handleVote(pId, event.target);
      item.append(titleEl, votesEl, voteBtn);
      if (proposalsListDiv) proposalsListDiv.appendChild(item);
    });
  }
  if (!isSessionActive) displayWinner(proposals);
  else if (winnerMessageDiv) winnerMessageDiv.classList.add("hidden");
}

// Handle voting for a proposal
const handleVote = async (proposalId, buttonElement) => {
  if (!currentSessionId) return;
  const storageKey = `voted_in_session_${currentSessionId}`;
  if (localStorage.getItem(storageKey)) {
    setStatus(votingStatus, "You have already voted in this poll.", "info");
    if (buttonElement) buttonElement.disabled = true; return;
  }
  if (buttonElement) buttonElement.disabled = true;
  try {
    const sessionNode = await db.get(currentSessionId);
    if (!sessionNode || !sessionNode.result || sessionNode.result.value.status !== "active" || sessionNode.result.value.endTime <= Date.now()) {
      setStatus(votingStatus, "This poll has closed.", "info");
      await updateProposalsUI(currentSessionId); return;
    }
    const proposalNode = await db.get(proposalId);
    if (proposalNode && proposalNode.result) {
      const updated = { ...proposalNode.result.value, votes: (proposalNode.result.value.votes || 0) + 1 };
      await db.put(updated, proposalId);
      localStorage.setItem(storageKey, proposalId);
      await updateProposalsUI(currentSessionId);
    }
  } catch (e) {
    setStatus(votingStatus, `Error processing your vote: ${e.message}`, "error");
    if (buttonElement) {
      if (!localStorage.getItem(storageKey)) {
        const sNode = await db.get(currentSessionId).catch(() => null);
        if (sNode && sNode.result && sNode.result.value.status === 'active' && sNode.result.value.endTime > Date.now()) {
          buttonElement.disabled = false;
        }
      }
    }
  }
}

// Start main countdown for poll
const startMainCountdown = (endTime, sessionId) => {
  const mainCountdownId = `main-cd-${sessionId}`;
  if (countdownIntervals[mainCountdownId]) clearInterval(countdownIntervals[mainCountdownId]);
  function update() {
    if (!countdownDisplay || !document.body.contains(countdownDisplay)) { clearInterval(countdownIntervals[mainCountdownId]); delete countdownIntervals[mainCountdownId]; return; }
    const timeLeft = endTime - Date.now();
    if (timeLeft <= 0) {
      clearInterval(countdownIntervals[mainCountdownId]); delete countdownIntervals[mainCountdownId];
      if (countdownDisplay) countdownDisplay.textContent = "Poll has ended.";
      db.get(sessionId).then(sNode => {
        if (sNode && sNode.result && sNode.result.value.status === 'active') {
          db.put({ ...sNode.result.value, status: 'ended' }, sessionId).catch(err => console.warn("Err ending session (main countdown):", err));
        }
      }).catch(err => console.warn("Err get session (main countdown):", err));
      return;
    }
    const d = Math.floor(timeLeft / (1000 * 60 * 60 * 24)), h = Math.floor(timeLeft / (1000 * 60 * 60) % 24), m = Math.floor(timeLeft / 60000 % 60), s = Math.floor(timeLeft / 1000 % 60);
    if (countdownDisplay) countdownDisplay.textContent = `Time remaining: ${d}d ${h}h ${m}m ${s}s`;
  }
  update(); countdownIntervals[mainCountdownId] = setInterval(update, 1000);
}

// Display winner(s) of the poll
const displayWinner = (proposals) => {
  if (!winnerMessageDiv) return;
  winnerMessageDiv.classList.remove("hidden");
  if (!proposals || proposals.length === 0) { winnerMessageDiv.textContent = "Poll ended. No proposals or votes."; return; }
  let maxVotes = -1;
  proposals.forEach(p => { if (p && p.value && (p.value.votes || 0) > maxVotes) maxVotes = p.value.votes; });
  if (maxVotes <= 0) { winnerMessageDiv.textContent = "Poll ended. No valid votes recorded."; return; }
  const winners = proposals.filter(p => p && p.value && (p.value.votes || 0) === maxVotes);
  if (winners.length === 1) winnerMessageDiv.textContent = `🏆 WINNER: "${winners[0].value.title}" (${maxVotes} votes).`;
  else winnerMessageDiv.textContent = `🏆 TIE! (${maxVotes} votes): ${winners.map(w => `"${w.value.title}"`).join(', ')}.`;
}

// Initialize app routing based on hash
const initializeAppRouting = () => {
  const hash = window.location.hash.substring(1);
  Object.values(countdownIntervals).forEach(clearInterval);
  for (const key in countdownIntervals) delete countdownIntervals[key];
  if (sessionsListenerUnsubscribe) { sessionsListenerUnsubscribe(); sessionsListenerUnsubscribe = null; }

  db.map(
    { query: { type: "votingSession" }, field: "createdAt", order: "desc", realtime: true },
    (event) => {
      renderActiveVotingsList();
      // If the current session is the one that changed, AND it wasn't a 'removed' event (handled by delete func)
      if (currentSessionId && event.id === currentSessionId && event.action !== 'removed') {
        loadVotingSession(currentSessionId); // Reload to reflect potential external changes (e.g. name edit by another peer)
      }
    }
  ).then(handler => { if (handler && typeof handler.unsubscribe === 'function') sessionsListenerUnsubscribe = handler.unsubscribe; })
    .catch(err => { console.error("Error subscribing to sessions:", err); });

  if (hash) {
    if (creatorView) creatorView.classList.add("hidden");
    if (votingView) votingView.classList.remove("hidden");
    loadVotingSession(hash);
  } else {
    if (votingView) votingView.classList.add("hidden");
    if (creatorView) creatorView.classList.remove("hidden");
    currentSessionId = null;
    resetCreatorForm();
  }
}

window.addEventListener('hashchange', initializeAppRouting);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeAppRouting);
else initializeAppRouting();