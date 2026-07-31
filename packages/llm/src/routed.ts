import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamHandlers,
} from './types.js';

/**
 * Fournisseur composite : un modèle pour la voix, un autre pour le volume.
 *
 * Valmont fait deux choses très différentes avec un modèle de langage :
 *
 *  - **Parler.** Quelques dizaines d'appels par jour, où la nuance de ton, la
 *    finesse du raisonnement et la qualité du français décident de tout. C'est
 *    la seule chose que l'utilisateur voit.
 *  - **Structurer.** Extraction, résumé, classification, reformulation : des
 *    centaines d'appels, invisibles, sur des tâches mécaniques où un bon
 *    modèle ouvert fait aussi bien qu'un modèle de pointe.
 *
 * Les faire tourner sur le même modèle est un gâchis dans un sens ou une
 * perte de qualité dans l'autre. Ce routeur permet de mettre Claude sur la
 * voix et Groq — dix fois plus rapide, une fraction du prix — sur le reste.
 *
 * Le routage se fait sur le modèle demandé : les agents de fond appellent déjà
 * `llm.fastModel` explicitement, donc aucun agent n'a à connaître ce montage.
 */
export class RoutedProvider implements LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly fastModel: string;

  constructor(
    private readonly voice: LLMProvider,
    private readonly background: LLMProvider,
  ) {
    this.name = `${voice.name}+${background.name}`;
    this.defaultModel = voice.defaultModel;
    this.fastModel = background.fastModel;
  }

  private route(request: LLMRequest): LLMProvider {
    return request.model === this.fastModel ? this.background : this.voice;
  }

  complete(request: LLMRequest): Promise<LLMResponse> {
    return this.route(request).complete(request);
  }

  stream(request: LLMRequest, handlers: LLMStreamHandlers): Promise<LLMResponse> {
    return this.route(request).stream(request, handlers);
  }

  health(): { ok: boolean; detail?: string } {
    const voice = this.voice.health();
    const background = this.background.health();
    return {
      // La voix est indispensable ; un fournisseur de fond en panne dégrade la
      // mémoire mais laisse Valmont parler.
      ok: voice.ok,
      detail: `voix ${this.voice.name} (${voice.detail ?? 'ok'}) · fond ${this.background.name} (${background.detail ?? 'ok'})`,
    };
  }
}
