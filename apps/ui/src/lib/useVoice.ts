'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voix : écoute continue, détection d'activité vocale, synthèse, interruption.
 *
 * Deux choix structurants :
 *
 *  1. **Détection d'activité vocale maison, par énergie.** Un modèle de VAD
 *     embarqué coûte plusieurs mégaoctets et une latence de chargement, pour
 *     un gain nul dans une pièce calme — le cas d'usage réel d'une IA
 *     personnelle. La mesure d'énergie RMS avec seuil adaptatif et fenêtre de
 *     maintien suffit, tient en cinquante lignes, et démarre instantanément.
 *
 *  2. **Interruption par la voix (« barge-in »).** Dès que l'utilisateur parle
 *     alors que Valmont parle, la synthèse est coupée net. Sans ça, on ne peut
 *     pas couper la parole à Valmont, et la conversation cesse d'être naturelle.
 *
 * L'API Web Speech assure la transcription. Elle est derrière une interface
 * pour qu'un moteur local (Whisper) puisse la remplacer sans toucher au reste.
 */

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

function getRecognition(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceOptions {
  /** Appelé quand une phrase complète est transcrite. */
  onUtterance: (text: string) => void;
  /** Appelé quand l'utilisateur commence à parler — sert au barge-in. */
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  locale?: string;
}

export function useVoice(options: VoiceOptions) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  /** Niveau audio 0-1 — alimente la pulsation du noyau holographique. */
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const speakingRef = useRef(false);
  const wantListeningRef = useRef(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    setSupported(getRecognition() !== null);
  }, []);

  /** Coupe la synthèse immédiatement. */
  const stopSpeaking = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  /**
   * Boucle d'analyse : mesure l'énergie du micro, en déduit le niveau pour
   * l'animation et détecte le début de parole.
   */
  const startAnalysis = useCallback(async () => {
    if (audioContextRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;

    const context = new AudioContext();
    audioContextRef.current = context;

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    analyserRef.current = analyser;

    const buffer = new Float32Array(analyser.fftSize);
    // Seuil adaptatif : le bruit de fond d'une pièce varie, un seuil fixe
    // rendrait la détection inutilisable ailleurs que là où on l'a réglée.
    let noiseFloor = 0.008;
    let voiceFrames = 0;
    let silenceFrames = 0;
    let speechActive = false;

    const tick = (): void => {
      analyser.getFloatTimeDomainData(buffer);

      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += (buffer[i] ?? 0) ** 2;
      const rms = Math.sqrt(sum / buffer.length);

      setLevel(Math.min(1, rms * 9));

      const threshold = Math.max(0.012, noiseFloor * 3.2);

      if (rms > threshold) {
        voiceFrames++;
        silenceFrames = 0;
        // ~5 images consécutives : filtre les claquements et les clics.
        if (!speechActive && voiceFrames > 5) {
          speechActive = true;
          // Barge-in : on coupe Valmont dès que l'utilisateur ouvre la bouche.
          if (speakingRef.current) stopSpeaking();
          optionsRef.current.onSpeechStart?.();
        }
      } else {
        // Le plancher de bruit ne se met à jour que pendant le silence.
        noiseFloor = noiseFloor * 0.97 + rms * 0.03;
        silenceFrames++;
        voiceFrames = 0;
        // ~40 images (≈0,65 s) de silence : une pause dans une phrase ne doit
        // pas être prise pour une fin de tour.
        if (speechActive && silenceFrames > 40) {
          speechActive = false;
          optionsRef.current.onSpeechEnd?.();
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    tick();
  }, [stopSpeaking]);

  const stopAnalysis = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    const Recognition = getRecognition();
    if (!Recognition) return;

    wantListeningRef.current = true;
    await startAnalysis();

    const recognition = new Recognition();
    recognition.lang = optionsRef.current.locale ?? 'fr-FR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let final = '';
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        if (result.isFinal) final += result[0].transcript;
        else partial += result[0].transcript;
      }
      setInterim(partial);
      if (final.trim()) {
        setInterim('');
        optionsRef.current.onUtterance(final.trim());
      }
    };

    // Le moteur du navigateur s'arrête tout seul après un silence prolongé.
    // En mode mains libres, on le relance : la conversation doit rester ouverte.
    recognition.onend = () => {
      if (wantListeningRef.current) {
        try {
          recognition.start();
        } catch {
          /* déjà en cours de redémarrage */
        }
      } else {
        setListening(false);
      }
    };

    recognition.onerror = () => {
      /* micro refusé ou réseau : `onend` prendra le relais */
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [startAnalysis]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    stopAnalysis();
    setListening(false);
    setInterim('');
  }, [stopAnalysis]);

  /** Fait parler Valmont. Résout quand la phrase est terminée ou coupée. */
  const speak = useCallback((text: string): Promise<void> => {
    if (typeof window === 'undefined' || !text.trim()) return Promise.resolve();

    return new Promise((resolve) => {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      utterance.rate = 1.04;
      utterance.pitch = 0.92;

      const voices = window.speechSynthesis.getVoices();
      const french = voices.find(
        (voice) => voice.lang.startsWith('fr') && /Thomas|Daniel|Grand|Enhanced|Premium/i.test(voice.name),
      ) ?? voices.find((voice) => voice.lang.startsWith('fr'));
      if (french) utterance.voice = french;

      utterance.onstart = () => {
        speakingRef.current = true;
        setSpeaking(true);
      };
      const finish = (): void => {
        speakingRef.current = false;
        setSpeaking(false);
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = finish;

      window.speechSynthesis.speak(utterance);
    });
  }, []);

  useEffect(
    () => () => {
      wantListeningRef.current = false;
      recognitionRef.current?.abort();
      stopAnalysis();
      if (typeof window !== 'undefined') window.speechSynthesis.cancel();
    },
    [stopAnalysis],
  );

  return { supported, listening, speaking, level, interim, start, stop, speak, stopSpeaking };
}
