// Full emoji picker using the locally hosted Google Noto graphics,
// with search, categories and skin tones. Thin wrapper around emoji-mart so
// the inbox only depends on our own small surface. Lazy-loaded by the composer.
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data/sets/15/google.json";
import { EMOJI_SHEET } from "./EmojiGlyph";

// pt-PT labels for the picker chrome (emoji-mart defaults to English).
const I18N_PT = {
  search: "Pesquisar",
  search_no_results_1: "Nenhum emoji encontrado",
  search_no_results_2: "Tenta outra palavra.",
  pick: "Escolhe um emoji…",
  add_custom: "Adicionar emoji personalizado",
  categories: {
    activity: "Atividades",
    custom: "Personalizados",
    flags: "Bandeiras",
    foods: "Comida e Bebida",
    frequent: "Usados com frequência",
    nature: "Animais e Natureza",
    objects: "Objetos",
    people: "Sorrisos e Pessoas",
    places: "Viagens e Lugares",
    symbols: "Símbolos",
  },
  skins: {
    choose: "Escolhe o tom de pele padrão",
    "1": "Padrão",
    "2": "Claro",
    "3": "Médio-claro",
    "4": "Médio",
    "5": "Médio-escuro",
    "6": "Escuro",
  },
};

export function EmojiPicker({ onSelect }: { onSelect: (native: string) => void }) {
  return (
    <Picker
      data={data}
      set="google"
      getSpritesheetURL={() => EMOJI_SHEET}
      theme="auto"
      i18n={I18N_PT}
      previewPosition="none"
      skinTonePosition="search"
      perLine={8}
      maxFrequentRows={2}
      navPosition="top"
      onEmojiSelect={(emoji: { native?: string }) => {
        if (emoji?.native) onSelect(emoji.native);
      }}
    />
  );
}
