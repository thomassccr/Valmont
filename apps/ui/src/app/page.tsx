'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ValmontState } from '@valmont/types';
import { useValmont } from '@/lib/useValmont';
import { useVoice } from '@/lib/useVoice';
import styles from './page.module.css';

// Le noyau embarque Three.js : chargé côté client uniquement, et hors du
// chemin critique. L'interface s'affiche instantanément, le noyau s'allume
// une fraction de seconde plus tard — ce qui donne, à l'usage, l'impression
// d'un système qui se réveille.
const HoloCore = dynamic(() => import('@/core/HoloCore').then((m) => m.HoloCore), {
  ssr: false,
});

const STATE_LABELS: Record<ValmontState, string> = {
  dormant: 'hors ligne',
  idle: 'présent',
  listening: 'écoute',
  thinking: 'réfléchit',
  speaking: 'parle',
  working: 'travaille',
};

export default function Page() {
  const valmont = useValmont();
  const [draft, setDraft] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const spokenRef = useRef<string | null>(null);

  const voice = useVoice({
    onUtterance: (text) => valmont.say(text, 'voice'),
    onSpeechStart: () => {
      // L'utilisateur parle : on coupe Valmont et on annule le tour en cours.
      valmont.interrupt();
      valmont.setListening(true);
    },
    onSpeechEnd: () => valmont.setListening(false),
  });

  // Défilement automatique sur le dernier tour.
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
  }, [valmont.turns]);

  // Lecture vocale des réponses, uniquement en mode mains libres et une seule
  // fois par message : sans ce garde, chaque fragment de flux relancerait la
  // synthèse depuis le début.
  useEffect(() => {
    if (!voice.listening) return;
    const last = valmont.turns.at(-1);
    if (!last || last.role !== 'valmont' || last.streaming) return;
    if (spokenRef.current === last.id) return;
    spokenRef.current = last.id;
    void voice.speak(last.text);
  }, [valmont.turns, voice]);

  const submit = useCallback(() => {
    if (!draft.trim()) return;
    valmont.say(draft);
    setDraft('');
  }, [draft, valmont]);

  const toggleVoice = useCallback(() => {
    if (voice.listening) {
      voice.stop();
      valmont.setListening(false);
    } else {
      void voice.start();
    }
  }, [voice, valmont]);

  const busy = valmont.state !== 'idle' && valmont.state !== 'dormant';

  return (
    <main className={styles.shell}>
      <HoloCore
        className={styles.core}
        state={valmont.state}
        audioLevel={voice.listening || voice.speaking ? voice.level : 0}
      />

      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>Valmont</span>
          <span className={`${styles.status} ${busy ? styles.statusActive : ''}`}>
            {valmont.connected ? STATE_LABELS[valmont.state] : 'connexion…'}
          </span>
        </div>

        {valmont.boot && (
          <div className={styles.meta}>
            <span>{valmont.boot.memoryCount.toLocaleString('fr-FR')} souvenirs</span>
            <span>{valmont.boot.entityCount} éléments</span>
            {valmont.boot.since && (
              <span>depuis {new Date(valmont.boot.since).toLocaleDateString('fr-FR')}</span>
            )}
          </div>
        )}
      </header>

      <div className={styles.stream} ref={streamRef}>
        {valmont.turns.map((turn) => (
          <div
            key={turn.id}
            className={`${styles.turn} ${turn.role === 'user' ? styles.user : styles.valmont} ${
              turn.spontaneous ? styles.spontaneous : ''
            }`}
          >
            {turn.text}
            {turn.streaming && <span className={styles.caret} />}

            {turn.spontaneous && turn.initiativeId && (
              <div className={styles.spontaneousActions}>
                <button
                  className={styles.ghost}
                  onClick={() => valmont.resolveInitiative(turn.initiativeId!, 'acted')}
                >
                  On en parle
                </button>
                <button
                  className={styles.ghost}
                  onClick={() => valmont.resolveInitiative(turn.initiativeId!, 'dismissed')}
                >
                  Pas maintenant
                </button>
              </div>
            )}
          </div>
        ))}

        {valmont.tool && (
          <div className={styles.tool}>
            <span className={styles.toolDot} />
            {valmont.tool.label}
          </div>
        )}
      </div>

      <div className={`${styles.composer} ${busy ? styles.composerActive : ''}`}>
        {voice.interim && <div className={styles.interim}>{voice.interim}</div>}

        <textarea
          className={styles.input}
          rows={1}
          value={draft}
          placeholder={voice.listening ? 'Je t’écoute…' : 'Parle-moi.'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
            // Échap coupe Valmont en pleine phrase, au clavier comme à la voix.
            if (event.key === 'Escape') {
              valmont.interrupt();
              voice.stopSpeaking();
            }
          }}
        />

        {voice.supported && (
          <button
            className={`${styles.mic} ${voice.listening ? styles.micOn : ''}`}
            onClick={toggleVoice}
            aria-label={voice.listening ? 'Couper le micro' : 'Mode mains libres'}
            title={voice.listening ? 'Couper le micro' : 'Mode mains libres'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v4" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {!panelOpen && (
        <button className={styles.panelToggle} onClick={() => setPanelOpen(true)}>
          Profil
        </button>
      )}

      {panelOpen && <Panel valmont={valmont} onClose={() => setPanelOpen(false)} />}
    </main>
  );
}

function Panel({
  valmont,
  onClose,
}: {
  valmont: ReturnType<typeof useValmont>;
  onClose: () => void;
}) {
  useEffect(() => {
    valmont.refreshDashboard();
  }, [valmont]);

  const trends = (valmont.dashboard?.trends ?? []).filter((trend) => trend.sampleSize > 0);
  const correlations = valmont.dashboard?.correlations ?? [];
  const streaks = valmont.dashboard?.streaks ?? [];

  return (
    <aside className={styles.panel}>
      <button className={styles.panelTitle} onClick={onClose}>
        ← Profil
      </button>

      <section className={styles.section}>
        <div className={styles.panelTitle}>Cette semaine</div>
        {trends.length === 0 ? (
          <p className={styles.empty}>Pas encore assez de données. Parle-lui, il construira ton profil.</p>
        ) : (
          trends.map((trend) => (
            <div key={trend.key} className={styles.metric}>
              <span className={styles.metricName}>{trend.key}</span>
              <span
                className={`${styles.metricValue} ${
                  trend.direction === 'up' ? styles.up : trend.direction === 'down' ? styles.down : ''
                }`}
              >
                {trend.current.toFixed(1)}
                {trend.direction !== 'flat' && (
                  <> · {trend.delta > 0 ? '+' : ''}{Math.round(trend.delta * 100)}%</>
                )}
              </span>
            </div>
          ))
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.panelTitle}>Ce qui t’occupe</div>
        {valmont.themes.length === 0 ? (
          <p className={styles.empty}>Les thèmes émergent au fil des conversations.</p>
        ) : (
          valmont.themes.map((theme) => (
            <div key={theme.id} className={styles.themeRow}>
              <span className={styles.themeLabel}>{theme.label}</span>
              <span className={styles.themeBar}>
                <span
                  className={styles.themeFill}
                  style={{ width: `${Math.min(100, theme.weight * 180)}%` }}
                />
              </span>
              <span className={styles.metricValue}>
                {theme.momentum > 0.25 ? '↑' : theme.momentum < -0.25 ? '↓' : '·'}
              </span>
            </div>
          ))
        )}
      </section>

      {streaks.length > 0 && (
        <section className={styles.section}>
          <div className={styles.panelTitle}>Régularité</div>
          {streaks.map((streak) => (
            <div key={streak.habit} className={styles.metric}>
              <span className={styles.metricName}>{streak.habit}</span>
              <span className={styles.metricValue}>
                {streak.currentStreak}j · record {streak.bestStreak}j
              </span>
            </div>
          ))}
        </section>
      )}

      {correlations.length > 0 && (
        <section className={styles.section}>
          <div className={styles.panelTitle}>Ce qu’il a remarqué</div>
          {correlations.map((correlation) => (
            <p key={`${correlation.a}-${correlation.b}`} className={styles.insight}>
              Quand <strong>{correlation.a}</strong> augmente,{' '}
              <strong>{correlation.b}</strong>
              {correlation.lagDays ? ' le lendemain' : ''}{' '}
              {correlation.r > 0 ? 'suit' : 'baisse'}.
              <br />
              <span className={styles.empty}>
                r = {correlation.r.toFixed(2)} sur {correlation.sampleSize} jours
              </span>
            </p>
          ))}
        </section>
      )}
    </aside>
  );
}
