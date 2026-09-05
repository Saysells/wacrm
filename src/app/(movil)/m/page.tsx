import { MobileScreen } from "@/components/movil/screen";

// Marcador del Bloque 2: el shell ya navega y el tabbar ya marca la
// pestaña. La lista real, con datos de Supabase, entra en el Bloque 3.
export default function BandejaPage() {
  return (
    <MobileScreen title="Bandeja">
      <div className="m-empty">
        <b>Shell listo</b>
        La lista de conversaciones entra en el proximo bloque.
      </div>
    </MobileScreen>
  );
}
