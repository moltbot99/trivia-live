"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { deleteField } from "firebase/firestore";
import { CopyBox } from "@/components/CopyBox";
import {
  joinAsPlayer,
  judgeFinal,
  judgeSubmission,
  patchRoomIfHost,
  removePlayer,
  resetAllScores,
  submitAnswer,
  submitFinalAnswer,
  submitWager,
  subscribeFinalAnswers,
  subscribePlayers,
  subscribeRoom,
  subscribeSubmissions,
  subscribeWagers
} from "@/lib/room";
import { clamp, safeTrim } from "@/lib/util";
import { FinalAnswer, Player, Room, Submission, Wager } from "@/lib/types";

function useLocalId(key: string) {
  const [id, setId] = useState<string>("");
  useEffect(() => {
    const existing = localStorage.getItem(key);
    if (existing) {
      setId(existing);
    } else {
      const generated = crypto.randomUUID();
      localStorage.setItem(key, generated);
      setId(generated);
    }
  }, [key]);
  return id;
}

export default function RoomPage({ params }: { params: { roomId: string } }) {
  const roomId = params.roomId;
  const sp = useSearchParams();
  const hostSecret = sp.get("host") ?? "";

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [wagers, setWagers] = useState<Wager[]>([]);
  const [finalAnswers, setFinalAnswers] = useState<FinalAnswer[]>([]);
  const [suddenDeathSubs, setSuddenDeathSubs] = useState<Submission[]>([]);

  const playerId = useLocalId(`trivia_player_${roomId}`);
  const [playerName, setPlayerName] = useState<string>("");
  const [joined, setJoined] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [expandedField, setExpandedField] = useState<{ type: "question" | "answer" | "category"; text: string; questionIndex: number } | null>(null);
  const [showSuddenDeathResults, setShowSuddenDeathResults] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeRoom(roomId, setRoom), [roomId]);
  useEffect(() => subscribePlayers(roomId, setPlayers), [roomId]);
  useEffect(() => {
    if (!room) return;
    return subscribeSubmissions(roomId, room.currentIndex, setSubs);
  }, [roomId, room]);
  useEffect(() => subscribeWagers(roomId, setWagers), [roomId]);
  useEffect(() => subscribeFinalAnswers(roomId, setFinalAnswers), [roomId]);
  useEffect(() => {
    if (!room || !room.suddenDeath?.active) return;
    return subscribeSubmissions(roomId, 999, setSuddenDeathSubs); // Use index 999 for sudden death
  }, [roomId, room]);

  const isHost = useMemo(() => !!room && hostSecret && room.hostSecret === hostSecret, [room, hostSecret]);

  // Helper to determine if all final answers are judged
  const allFinalAnswersJudged = useMemo(() => {
    if (!finalAnswers.length || !players.length) return false;
    const playersWithAnswers = finalAnswers.filter(a => a.judged !== null);
    return playersWithAnswers.length === players.length || (finalAnswers.length > 0 && finalAnswers.every(a => a.judged !== null));
  }, [finalAnswers, players]);

  // Get leaders (players tied for first)
  const leaders = useMemo(() => {
    if (!players.length) return [];
    const maxScore = Math.max(...players.map(p => p.score));
    return players.filter(p => p.score === maxScore);
  }, [players]);

  // Detect sudden death winner
  const suddenDeathWinner = useMemo(() => {
    if (!room?.suddenDeath?.active || !suddenDeathSubs.length) return null;
    const winningSubmission = suddenDeathSubs.find(s => s.judged === true);
    if (!winningSubmission) return null;
    return players.find(p => p.id === winningSubmission.playerId) || null;
  }, [room, suddenDeathSubs, players]);

  // Show modal when sudden death winner is determined
  useEffect(() => {
    if (suddenDeathWinner && !showSuddenDeathResults) {
      setShowSuddenDeathResults(true);
    }
  }, [suddenDeathWinner, showSuddenDeathResults]);

  // Timer effect: auto-close answers after 30 seconds
  useEffect(() => {
    if (!room || !room.revealed || !room.acceptingAnswers || !room.revealedAt) {
      setTimeRemaining(null);
      return;
    }

    const revealTime = room.revealedAt.toMillis ? room.revealedAt.toMillis() : room.revealedAt;
    const interval = setInterval(() => {
      const elapsed = Date.now() - revealTime;
      const remaining = Math.max(0, 30 - Math.floor(elapsed / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0 && room.acceptingAnswers && isHost) {
        patchRoomIfHost(roomId, hostSecret, { acceptingAnswers: false });
      }
    }, 100);

    return () => clearInterval(interval);
  }, [room, roomId, hostSecret, isHost]);

  const me = useMemo(() => players.find((p) => p.id === playerId) ?? null, [players, playerId]);
  const currentQ = useMemo(() => room?.questions?.[room?.currentIndex ?? 0] ?? null, [room]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const joinLink = origin ? `${origin}/r/${roomId}` : `/r/${roomId}`;
  const hostLink = origin && room ? `${origin}/r/${roomId}?host=${room.hostSecret}` : "";

  if (!room) {
    return (
      <div className="card">
        <div className="h2">Loading…</div>
        <div className="small">If this never loads, the room code may be wrong.</div>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ alignItems: "stretch" }}>
        <div className="card" style={{ flex: 1, minWidth: 280 }}>
          <div className="h1">
            <span className="mono">{roomId}</span> — {room.title}
          </div>
          <div className="small">
            Status: {room.status} • Q{room.currentIndex + 1}/10
            {timeRemaining !== null && timeRemaining > 0 && (
              <span style={{ marginLeft: 8, fontWeight: 700, color: timeRemaining <= 10 ? "#ff6b6b" : "#4ecdc4" }}>
                ⏱ {timeRemaining}s
              </span>
            )}
          </div>
          <div className="small">Mode: {isHost ? "HOST" : "PLAYER"}</div>
        </div>

        <div className="card" style={{ flex: 1, minWidth: 280 }}>
          <div className="h2">Leaderboard</div>
          <div className="grid" style={{ gap: 8 }}>
            {[...players]
              .sort((a, b) => b.score - a.score)
              .slice(0, 10)
              .map((p) => (
                <div key={p.id} className="row" style={{ justifyContent: "space-between" }}>
                  <div>{p.name}</div>
                  <div className="mono">{p.score}</div>
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="row">
        <CopyBox label="Invite link" value={joinLink} />
        {isHost && hostLink ? <CopyBox label="Host link (keep private)" value={hostLink} /> : null}
      </div>

      {room.status === "ended" && !isHost ? (
        <ResultsView
          players={players}
          me={me}
        />
      ) : isHost ? (
        <HostView
          roomId={roomId}
          room={room}
          hostSecret={hostSecret}
          players={players}
          subs={subs}
          wagers={wagers}
          finalAnswers={finalAnswers}
          suddenDeathSubs={suddenDeathSubs}
          allFinalAnswersJudged={allFinalAnswersJudged}
          leaders={leaders}
          expandedField={expandedField}
          setExpandedField={setExpandedField}
        />
      ) : (
        <PlayerView
          roomId={roomId}
          room={room}
          playerId={playerId}
          me={me}
          playerName={playerName}
          setPlayerName={setPlayerName}
          joined={joined}
          setJoined={setJoined}
          expandedField={expandedField}
          setExpandedField={setExpandedField}
        />
      )}

      {expandedField && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20
          }}
          onClick={() => setExpandedField(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: 600,
              maxHeight: "80vh",
              overflow: "auto",
              animation: "fadeIn 0.2s ease-in"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="h2" style={{ textTransform: "capitalize", margin: 0 }}>
                Q{expandedField.questionIndex + 1} - {expandedField.type === "question" ? "Question" : expandedField.type === "answer" ? "Answer" : "Category"}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn btnSecondary"
                  style={{ padding: "6px 12px" }}
                  disabled={expandedField.questionIndex === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    const prevIndex = expandedField.questionIndex - 1;
                    const prevQ = room?.questions[prevIndex];
                    if (prevQ) {
                      const fieldValue = expandedField.type === "question" ? prevQ.question : expandedField.type === "answer" ? prevQ.answer : prevQ.category || "";
                      setExpandedField({ type: expandedField.type, text: fieldValue, questionIndex: prevIndex });
                    }
                  }}
                >
                  ← Prev
                </button>
                <button
                  className="btn btnSecondary"
                  style={{ padding: "6px 12px" }}
                  disabled={expandedField.questionIndex === 9}
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextIndex = expandedField.questionIndex + 1;
                    const nextQ = room?.questions[nextIndex];
                    if (nextQ) {
                      const fieldValue = expandedField.type === "question" ? nextQ.question : expandedField.type === "answer" ? nextQ.answer : nextQ.category || "";
                      setExpandedField({ type: expandedField.type, text: fieldValue, questionIndex: nextIndex });
                    }
                  }}
                >
                  Next →
                </button>
              </div>
            </div>
            <div className="hr" />
            <div style={{ fontSize: 16, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {expandedField.text || "(empty)"}
            </div>
            <div className="hr" />
            <button className="btn" onClick={() => setExpandedField(null)} style={{ width: "100%" }}>
              Close
            </button>
          </div>
          <style jsx>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {showSuddenDeathResults && suddenDeathWinner && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            padding: 20,
            animation: "fadeIn 0.3s ease-in"
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 600,
              maxHeight: "85vh",
              overflow: "auto",
              animation: "slideIn 0.4s ease-out"
            }}
          >
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
              <div className="h1" style={{ color: "#4ecdc4", marginBottom: 10 }}>
                {suddenDeathWinner.name} Wins!
              </div>
              <div className="small">Sudden death tiebreaker complete</div>
            </div>

            <div className="hr" />

            <div className="h2">Final Leaderboard</div>
            <div className="grid" style={{ gap: 12, marginTop: 16 }}>
              {[...players].sort((a, b) => b.score - a.score).map((p, idx) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    background: p.id === suddenDeathWinner.id ? "#1e4d3b" : "#0c1323",
                    borderRadius: 8,
                    border: p.id === suddenDeathWinner.id ? "2px solid #4ecdc4" : "1px solid #1e2a44"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      fontSize: 18,
                      fontWeight: 700,
                      minWidth: 30,
                      color: idx === 0 ? "#4ecdc4" : "#8ab4ff"
                    }}>
                      #{idx + 1}
                    </div>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    {p.id === suddenDeathWinner.id && <span style={{ fontSize: 20 }}>👑</span>}
                  </div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{p.score}</div>
                </div>
              ))}
            </div>

            <div className="hr" />
            {isHost && (
              <button
                className="btn"
                onClick={async () => {
                  setBusy(true);
                  try {
                    // Reset all scores
                    await resetAllScores(roomId, hostSecret);
                    // Generate new questions
                    const res = await fetch("/api/generate", { method: "POST" });
                    const data = await res.json();
                    // Reset game state
                    await patchRoomIfHost(roomId, hostSecret, {
                      questions: data.questions,
                      currentIndex: 0,
                      status: "lobby",
                      revealed: false,
                      acceptingAnswers: false,
                      final: { wagersOpen: false, answersOpen: false, revealedAnswer: false },
                      suddenDeath: deleteField() as any
                    });
                    setShowSuddenDeathResults(false);
                  } catch (err) {
                    alert(`Error starting new game: ${err}`);
                  } finally {
                    setBusy(false);
                  }
                }}
                style={{ width: "100%" }}
                disabled={busy}
              >
                Start New Game
              </button>
            )}
            {!isHost && (
              <div className="small" style={{ textAlign: "center", opacity: 0.7 }}>
                Waiting for host to start a new game...
              </div>
            )}
          </div>
          <style jsx>{`
            @keyframes slideIn {
              from {
                opacity: 0;
                transform: translateY(-30px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

function ResultsView({ players, me }: { players: Player[]; me: Player | null }) {
  const sortedPlayers = useMemo(() => [...players].sort((a, b) => b.score - a.score), [players]);
  const winner = sortedPlayers[0];
  const myRank = me ? sortedPlayers.findIndex(p => p.id === me.id) + 1 : 0;

  let message = "Better luck next time!";
  let messageColor = "#8ab4ff";

  if (me) {
    if (myRank === 1 && sortedPlayers.filter(p => p.score === winner?.score).length === 1) {
      message = "🎉 Congratulations! You won! 🎉";
      messageColor = "#4ecdc4";
    } else if (me.score === 0) {
      message = "You lost - better luck next time!";
      messageColor = "#ff6b6b";
    }
  }

  return (
    <div className="card">
      <div className="h1" style={{ textAlign: "center", marginBottom: 20 }}>Game Over!</div>

      {me && (
        <div style={{
          padding: 20,
          background: "#0c1323",
          borderRadius: 10,
          marginBottom: 20,
          textAlign: "center",
          fontSize: 20,
          color: messageColor,
          fontWeight: 600
        }}>
          {message}
        </div>
      )}

      <div className="h2">Final Leaderboard</div>
      <div className="hr" />
      <div className="grid" style={{ gap: 12 }}>
        {sortedPlayers.map((p, idx) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              background: p.id === me?.id ? "#1e2749" : "#0c1323",
              borderRadius: 8,
              border: idx === 0 ? "2px solid #4ecdc4" : "1px solid #1e2a44"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                fontSize: 18,
                fontWeight: 700,
                minWidth: 30,
                color: idx === 0 ? "#4ecdc4" : "#8ab4ff"
              }}>
                #{idx + 1}
              </div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              {idx === 0 && <span style={{ fontSize: 20 }}>👑</span>}
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{p.score}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HostView({
  roomId,
  room,
  hostSecret,
  players,
  subs,
  wagers,
  finalAnswers,
  suddenDeathSubs,
  allFinalAnswersJudged,
  leaders,
  expandedField,
  setExpandedField
}: {
  roomId: string;
  room: Room;
  hostSecret: string;
  players: Player[];
  subs: Submission[];
  wagers: Wager[];
  finalAnswers: FinalAnswer[];
  suddenDeathSubs: Submission[];
  allFinalAnswersJudged: boolean;
  leaders: Player[];
  expandedField: { type: "question" | "answer" | "category"; text: string; questionIndex: number } | null;
  setExpandedField: (field: { type: "question" | "answer" | "category"; text: string; questionIndex: number } | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const q = room.questions[room.currentIndex];

  async function generateGame() {
    setBusy(true);
    try {
      const res = await fetch("/api/generate", { method: "POST" });
      const data = await res.json();
      await patchRoomIfHost(roomId, hostSecret, {
        questions: data.questions,
        currentIndex: 0,
        status: "lobby",
        revealed: false,
        acceptingAnswers: false,
        final: { wagersOpen: false, answersOpen: false, revealedAnswer: false }
      });
    } finally {
      setBusy(false);
    }
  }

  async function resetScores() {
    if (!confirm("Reset all player scores to 0?")) return;
    try {
      await resetAllScores(roomId, hostSecret);
    } catch (err) {
      alert(`Error resetting scores: ${err}`);
    }
  }

  async function updateQField(idx: number, field: "question" | "answer" | "category", value: string) {
    const next = room.questions.map((qq, i) => (i === idx ? { ...qq, [field]: value } : qq));
    await patchRoomIfHost(roomId, hostSecret, { questions: next });
  }

  async function replaceQuestion(idx: number) {
    setBusy(true);
    try {
      const res = await fetch("/api/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: idx })
      });
      const data = await res.json();
      if (data.question) {
        const next = room.questions.map((q, i) => i === idx ? { ...data.question, id: String(idx + 1) } : q);
        await patchRoomIfHost(roomId, hostSecret, { questions: next });
      }
    } catch (err) {
      alert(`Error replacing question: ${err}`);
    } finally {
      setBusy(false);
    }
  }

  async function endGame() {
    await patchRoomIfHost(roomId, hostSecret, { status: "ended" });
  }

  async function startSuddenDeath() {
    setBusy(true);
    try {
      const res = await fetch("/api/replace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index: 10 }) });
      const data = await res.json();
      if (data.question) {
        await patchRoomIfHost(roomId, hostSecret, {
          suddenDeath: {
            active: true,
            question: { ...data.question, id: "sudden_death" },
            eligiblePlayerIds: leaders.map(p => p.id),
            revealed: false,
            acceptingAnswers: false
          }
        });
      }
    } catch (err) {
      alert(`Error starting sudden death: ${err}`);
    } finally {
      setBusy(false);
    }
  }

  async function replaceSuddenDeathQuestion() {
    setBusy(true);
    try {
      const res = await fetch("/api/replace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index: 10 }) });
      const data = await res.json();
      if (data.question) {
        await patchRoomIfHost(roomId, hostSecret, {
          suddenDeath: {
            ...room.suddenDeath!,
            question: { ...data.question, id: "sudden_death" }
          }
        });
      }
    } catch (err) {
      alert(`Error replacing sudden death question: ${err}`);
    } finally {
      setBusy(false);
    }
  }

  const isSuddenDeath = room.suddenDeath?.active;
  const suddenDeathQ = room.suddenDeath?.question;
  const nonFinal = room.currentIndex < 9;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="h2">Host Controls</div>
            <div className="small">Generate, edit, reveal, and grade.</div>
          </div>
          <div className="row">
            <button className="btn" disabled={busy} onClick={generateGame}>
              Generate Game (10)
            </button>
            <button className="btn" disabled={busy} onClick={resetScores}>
              Reset Scores
            </button>
          </div>
        </div>

        <div className="hr" />

        <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <div className="pill">
            <span className="mono">Q{room.currentIndex + 1}/10</span>
            <span className="small">{room.status}</span>
          </div>

          <div className="row">
            <button
              className="btn btnSecondary"
              disabled={room.currentIndex === 0}
              onClick={() => patchRoomIfHost(roomId, hostSecret, { currentIndex: room.currentIndex - 1, revealed: false, acceptingAnswers: false })}
            >
              Prev
            </button>
            <button
              className="btn btnSecondary"
              disabled={room.currentIndex === 9}
              onClick={() => patchRoomIfHost(roomId, hostSecret, { currentIndex: room.currentIndex + 1, revealed: false, acceptingAnswers: false })}
            >
              Next
            </button>
          </div>
        </div>

        <div className="hr" />

        <div className="grid" style={{ gap: 10 }}>
          <div className="h3">All Questions</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #444" }}>
                  <th style={{ textAlign: "left", padding: "8px", fontWeight: 600 }}>Q</th>
                  <th style={{ textAlign: "left", padding: "8px", fontWeight: 600 }}>Question</th>
                  <th style={{ textAlign: "left", padding: "8px", fontWeight: 600 }}>Answer</th>
                  <th style={{ textAlign: "left", padding: "8px", fontWeight: 600 }}>Category</th>
                  <th style={{ textAlign: "center", padding: "8px", fontWeight: 600 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {room.questions.map((question, idx) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: "1px solid #333",
                      backgroundColor: idx === room.currentIndex ? "#1e2749" : "transparent"
                    }}
                  >
                    <td style={{ padding: "8px", minWidth: 40, fontWeight: 600, cursor: "pointer" }} onClick={() => patchRoomIfHost(roomId, hostSecret, { currentIndex: idx, revealed: false, acceptingAnswers: false })}>
                      {idx + 1}
                    </td>
                    <td
                      style={{ padding: "8px", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedField({ type: "question", text: question.question, questionIndex: idx });
                      }}
                    >
                      {question.question || "(empty)"}
                    </td>
                    <td
                      style={{ padding: "8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedField({ type: "answer", text: question.answer, questionIndex: idx });
                      }}
                    >
                      <span className="mono">{question.answer || "(empty)"}</span>
                    </td>
                    <td
                      style={{ padding: "8px", minWidth: 100, cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedField({ type: "category", text: question.category || "", questionIndex: idx });
                      }}
                    >
                      {question.category || "(none)"}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <button
                        className="btn btnSecondary"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          replaceQuestion(idx);
                        }}
                      >
                        Replace
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hr" />

        <div className="row">
            {nonFinal ? (
              <>
                <button
                  className="btn"
                  onClick={() => patchRoomIfHost(roomId, hostSecret, { status: "question", revealed: true, acceptingAnswers: true, revealedAt: new Date() })}
                >
                  Reveal + Open Answers (30s)
                </button>
                <button
                  className="btn btnSecondary"
                  onClick={() => patchRoomIfHost(roomId, hostSecret, { acceptingAnswers: false })}
                >
                  Close Answers
                </button>
                <button
                  className="btn btnSecondary"
                  onClick={() => patchRoomIfHost(roomId, hostSecret, { revealed: false, acceptingAnswers: false })}
                >
                  Hide Question
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn"
                  onClick={() => patchRoomIfHost(roomId, hostSecret, { status: "final_wager", revealed: true, acceptingAnswers: false, final: { ...room.final, wagersOpen: true, answersOpen: false, revealedAnswer: false } })}
                >
                  Open Final Wagers
                </button>
                <button
                  className="btn btnSecondary"
                  onClick={() => patchRoomIfHost(roomId, hostSecret, { status: "final_answer", revealedAt: new Date(), acceptingAnswers: true, final: { ...room.final, wagersOpen: false, answersOpen: true } })}
                >
                  Open Final Answers (30s)
                </button>
              </>
            )}
          </div>

        <div className="hr" />
      </div>

      {nonFinal ? (
        <div className="card">
          <div className="h2">Submissions (Q{room.currentIndex + 1})</div>
          <div className="small">Tap Correct/Incorrect to score +1 (or 0). Each player can submit once per question.</div>
          <div className="hr" />

          <div className="grid" style={{ gap: 6 }}>
            {subs.length === 0 ? <div className="small">No answers yet.</div> : null}
            {subs.map((s) => (
              <div key={s.id} style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                background: "#0c1323",
                borderRadius: 6,
                fontSize: 14
              }}>
                <div style={{ fontWeight: 600, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.playerName}
                </div>
                <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.answer || <span style={{ opacity: 0.5 }}>(blank)</span>}
                </div>
                <div className="pill small" style={{ minWidth: 60, textAlign: "center" }}>
                  {s.judged === null ? "?" : s.judged ? "+1" : "0"}
                </div>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: "4px 12px", minWidth: 70 }}
                  disabled={s.judged !== null}
                  onClick={() => judgeSubmission(roomId, hostSecret, s.id, true)}
                >
                  ✓
                </button>
                <button
                  className="btn btnSecondary"
                  style={{ fontSize: 12, padding: "4px 12px", minWidth: 70 }}
                  disabled={s.judged !== null}
                  onClick={() => judgeSubmission(roomId, hostSecret, s.id, false)}
                >
                  ✗
                </button>
              </div>
            ))}
          </div>

          <div className="hr" />
          <div
            className="small"
            style={{ cursor: "pointer", padding: 4, borderRadius: 4, border: "1px solid transparent", transition: "border-color 0.2s", display: "inline-block" }}
            onClick={() => q.answer && setExpandedField({ type: "answer", text: q.answer, questionIndex: room.currentIndex })}
            onMouseEnter={(e) => { if (q.answer && q.answer.length > 60) e.currentTarget.style.borderColor = "#666"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent"; }}
            title={q.answer && q.answer.length > 60 ? "Click to expand" : ""}
          >
            Answer key (host): <span className="mono">{q.answer || "(not set)"}</span>
            {q.answer && q.answer.length > 60 && <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 12 }}>🔍</span>}
          </div>
        </div>
      ) : (
        <div className="grid grid2">
          <div className="card">
            <div className="h2">Final Wagers</div>
            <div className="small">Players can wager up to their current score.</div>
            <div className="hr" />
            <div className="grid" style={{ gap: 8 }}>
              {players.map((p) => {
                const w = wagers.find((x) => x.playerId === p.id);
                return (
                  <div key={p.id} className="row" style={{ justifyContent: "space-between" }}>
                    <div>{p.name} <span className="small">({p.score})</span></div>
                    <div className="mono">{w ? w.wager : "—"}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="h2">Final Answers</div>
            <div className="small">Score +wager if correct, -wager if incorrect.</div>
            <div className="hr" />

            <div className="grid" style={{ gap: 6 }}>
              {finalAnswers.length === 0 ? <div className="small">No final answers yet.</div> : null}
              {finalAnswers.map((a) => {
                const w = wagers.find((x) => x.playerId === a.playerId);
                return (
                  <div key={a.playerId} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    background: "#0c1323",
                    borderRadius: 6,
                    fontSize: 14
                  }}>
                    <div style={{ fontWeight: 600, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.playerName}
                    </div>
                    <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.answer || <span style={{ opacity: 0.5 }}>(blank)</span>}
                    </div>
                    <div className="pill small" style={{ minWidth: 80, textAlign: "center", whiteSpace: "nowrap" }}>
                      w{w ? w.wager : 0} • {a.judged === null ? "?" : a.judged ? `+${a.pointsDelta}` : `${a.pointsDelta}`}
                    </div>
                    <button
                      className="btn"
                      style={{ fontSize: 12, padding: "4px 12px", minWidth: 70 }}
                      disabled={a.judged !== null}
                      onClick={() => judgeFinal(roomId, hostSecret, a.playerId, true)}
                    >
                      ✓
                    </button>
                    <button
                      className="btn btnSecondary"
                      style={{ fontSize: 12, padding: "4px 12px", minWidth: 70 }}
                      disabled={a.judged !== null}
                      onClick={() => judgeFinal(roomId, hostSecret, a.playerId, false)}
                    >
                      ✗
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="hr" />
            <div
              className="small"
              style={{ cursor: "pointer", padding: 4, borderRadius: 4, border: "1px solid transparent", transition: "border-color 0.2s", display: "inline-block" }}
              onClick={() => q.answer && setExpandedField({ type: "answer", text: q.answer, questionIndex: room.currentIndex })}
              onMouseEnter={(e) => { if (q.answer && q.answer.length > 60) e.currentTarget.style.borderColor = "#666"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent"; }}
              title={q.answer && q.answer.length > 60 ? "Click to expand" : ""}
            >
              Final answer key (host): <span className="mono">{q.answer || "(not set)"}</span>
              {q.answer && q.answer.length > 60 && <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 12 }}>🔍</span>}
            </div>

            {allFinalAnswersJudged && (
              <>
                <div className="hr" />
                <div className="row" style={{ gap: 12 }}>
                  {leaders.length > 1 ? (
                    <button className="btn" disabled={busy || isSuddenDeath} onClick={startSuddenDeath}>
                      ⚡ Start Sudden Death ({leaders.length} tied)
                    </button>
                  ) : null}
                  <button className="btn btnSecondary" onClick={endGame}>
                    {leaders.length === 1 ? "End Game - Show Results" : "End Game (Tie)"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {isSuddenDeath && suddenDeathQ && (
        <div className="card">
          <div className="h2">⚡ Sudden Death Tiebreaker</div>
          <div className="small">Only players tied for first can answer. First correct answer wins!</div>
          <div className="hr" />

          <div className="grid" style={{ gap: 8, marginBottom: 16 }}>
            <div><strong>Eligible Players:</strong></div>
            {leaders.map(p => (
              <div key={p.id} className="pill">
                {p.name} ({p.score} pts)
              </div>
            ))}
          </div>

          <div className="hr" />
          <div><strong>Question:</strong> {suddenDeathQ.question || "(not set)"}</div>
          <div className="small"><strong>Answer:</strong> <span className="mono">{suddenDeathQ.answer || "(not set)"}</span></div>

          <div className="hr" />
          <div className="row">
            <button
              className="btn"
              onClick={() => patchRoomIfHost(roomId, hostSecret, { suddenDeath: { ...room.suddenDeath!, revealed: true, acceptingAnswers: true } })}
              disabled={room.suddenDeath?.revealed}
            >
              Reveal & Open Answers
            </button>
            <button
              className="btn btnSecondary"
              onClick={() => patchRoomIfHost(roomId, hostSecret, { suddenDeath: { ...room.suddenDeath!, acceptingAnswers: false } })}
            >
              Close Answers
            </button>
            <button
              className="btn btnSecondary"
              disabled={busy || room.suddenDeath?.acceptingAnswers}
              onClick={replaceSuddenDeathQuestion}
              title={room.suddenDeath?.acceptingAnswers ? "Close answers first" : "Generate a new question"}
            >
              Replace Question
            </button>
          </div>

          <div className="hr" />
          <div className="h3">Sudden Death Submissions</div>
          <div className="grid" style={{ gap: 6 }}>
            {suddenDeathSubs.length === 0 ? <div className="small">No answers yet.</div> : null}
            {suddenDeathSubs.map((s) => (
              <div key={s.id} style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                background: "#0c1323",
                borderRadius: 6,
                fontSize: 14
              }}>
                <div style={{ fontWeight: 600, minWidth: 120 }}>{s.playerName}</div>
                <div style={{ flex: 1 }}>{s.answer || <span style={{ opacity: 0.5 }}>(blank)</span>}</div>
                <div className="pill small">{s.judged === null ? "?" : s.judged ? "+1" : "0"}</div>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: "4px 12px", minWidth: 70 }}
                  disabled={s.judged !== null}
                  onClick={() => judgeSubmission(roomId, hostSecret, s.id, true)}
                >
                  ✓
                </button>
                <button
                  className="btn btnSecondary"
                  style={{ fontSize: 12, padding: "4px 12px", minWidth: 70 }}
                  disabled={s.judged !== null}
                  onClick={() => judgeSubmission(roomId, hostSecret, s.id, false)}
                >
                  ✗
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerView({
  roomId,
  room,
  playerId,
  me,
  playerName,
  setPlayerName,
  joined,
  setJoined,
  expandedField,
  setExpandedField
}: {
  roomId: string;
  room: Room;
  playerId: string;
  me: Player | null;
  playerName: string;
  setPlayerName: (s: string) => void;
  joined: boolean;
  setJoined: (b: boolean) => void;
  expandedField: { type: "question" | "answer" | "category"; text: string; questionIndex: number } | null;
  setExpandedField: (field: { type: "question" | "answer" | "category"; text: string; questionIndex: number } | null) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [wager, setWager] = useState<number>(0);

  useEffect(() => {
    if (me) setJoined(true);
  }, [me, setJoined]);

  const q = room.questions[room.currentIndex];
  const isFinal = room.currentIndex === 9;
  const isSuddenDeath = room.suddenDeath?.active;
  const suddenDeathQ = room.suddenDeath?.question;
  const isEligibleForSuddenDeath = room.suddenDeath?.eligiblePlayerIds.includes(playerId) ?? false;

  const canSeeQuestion = room.revealed;
  const canSeeSuddenDeath = room.suddenDeath?.revealed;

  return (
    <div className="grid" style={{ gap: 16 }}>
      {!joined ? (
        <div className="card">
          <div className="h2">Join as a player</div>
          <div className="small">Pick a name (shows on the host screen).</div>
          <div className="hr" />
          <input className="input" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Your name" />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn"
              disabled={!playerName.trim()}
              onClick={async () => {
                await joinAsPlayer(roomId, playerId, playerName);
                setJoined(true);
              }}
            >
              Join
            </button>
          </div>
        </div>
      ) : null}

      {joined ? (
        <div className="card">
          <div className="h2">You</div>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div>{me?.name}</div>
              <div className="mono" style={{ fontSize: 14, opacity: 0.8 }}>Score: {me?.score ?? 0}</div>
            </div>
            <button
              className="btn btnDanger"
              style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={async () => {
                if (confirm("Are you sure you want to leave the game?")) {
                  await removePlayer(roomId, playerId);
                  setJoined(false);
                  localStorage.removeItem(`trivia_player_${roomId}`);
                }
              }}
            >
              Leave Game
            </button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="h2">Question {room.currentIndex + 1}/10</div>
        {q.category ? <div className="pill small">{q.category}</div> : null}
        <div className="hr" />
        {canSeeQuestion ? (
          <div
            style={{ fontSize: 18, lineHeight: 1.4, cursor: "pointer", padding: 4, borderRadius: 4, border: "1px solid transparent", transition: "border-color 0.2s" }}
            onClick={() => q.question && setExpandedField({ type: "question", text: q.question, questionIndex: room.currentIndex })}
            onMouseEnter={(e) => { if (q.question && q.question.length > 80) e.currentTarget.style.borderColor = "#666"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent"; }}
            title={q.question && q.question.length > 80 ? "Click to expand" : ""}
          >
            {q.question || (isFinal ? "Final Jeopardy" : "(Host is editing question)")}
            {q.question && q.question.length > 80 && <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 14 }}>🔍</span>}
          </div>
        ) : (
          <div className="small">Waiting for the host to reveal the question…</div>
        )}
      </div>

      {joined && canSeeQuestion && !isFinal ? (
        <div className="card">
          <div className="h2">Submit your answer</div>
          <div className="small">Your answer is sent to the host immediately. You can update it until the host closes answers.</div>
          <div className="hr" />
          <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer" />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn"
              disabled={!room.acceptingAnswers}
              onClick={async () => {
                await submitAnswer(roomId, playerId, me?.name || playerName || "Player", room.currentIndex, answer);
              }}
            >
              {room.acceptingAnswers ? "Submit" : "Answers closed"}
            </button>
          </div>
        </div>
      ) : null}

      {joined && canSeeQuestion && isFinal ? (
        <div className="grid grid2">
          <div className="card">
            <div className="h2">Final Wager</div>
            <div className="small">You can wager up to your current score.</div>
            <div className="hr" />
            <input
              className="input"
              type="number"
              value={wager}
              onChange={(e) => setWager(Number(e.target.value))}
              min={0}
              max={me?.score ?? 0}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                disabled={!room.final.wagersOpen}
                onClick={async () => {
                  const max = me?.score ?? 0;
                  const w = clamp(Math.floor(wager), 0, max);
                  await submitWager(roomId, playerId, me?.name || playerName || "Player", w);
                }}
              >
                {room.final.wagersOpen ? "Submit wager" : "Wagers closed"}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="h2">Final Answer</div>
            <div className="small">Once the host opens final answers, submit yours.</div>
            <div className="hr" />
            <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your final answer" />
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                disabled={!room.final.answersOpen}
                onClick={async () => {
                  await submitFinalAnswer(roomId, playerId, me?.name || playerName || "Player", answer);
                }}
              >
                {room.final.answersOpen ? "Submit final answer" : "Final answers closed"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSuddenDeath && joined ? (
        <div className="card">
          <div className="h2">⚡ Sudden Death Tiebreaker!</div>
          {isEligibleForSuddenDeath ? (
            <div className="small" style={{ color: "#4ecdc4", fontWeight: 600 }}>You are eligible to answer - first correct answer wins!</div>
          ) : (
            <div className="small" style={{ color: "#8ab4ff" }}>Watching - only tied leaders can answer</div>
          )}
          <div className="hr" />

          {canSeeSuddenDeath && suddenDeathQ && (
            <>
              <div style={{ fontSize: 18, lineHeight: 1.4, marginBottom: 16 }}>
                {suddenDeathQ.question || "(Host is editing question)"}
              </div>

              {isEligibleForSuddenDeath && (
                <>
                  <div className="hr" />
                  <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer" />
                  <div className="row" style={{ marginTop: 10 }}>
                    <button
                      className="btn"
                      disabled={!room.suddenDeath?.acceptingAnswers}
                      onClick={async () => {
                        await submitAnswer(roomId, playerId, me?.name || playerName || "Player", 999, answer);
                      }}
                    >
                      {room.suddenDeath?.acceptingAnswers ? "Submit Answer" : "Answers closed"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {!canSeeSuddenDeath && (
            <div className="small" style={{ opacity: 0.7 }}>Waiting for host to reveal the sudden death question...</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
