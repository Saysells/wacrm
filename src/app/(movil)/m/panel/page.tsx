import { PantallaPendiente } from "@/components/movil/screen";

// Pantalla vacia con su titulo y su entrada en el tabbar. La sesion 1
// construye Bandeja y Chat; esta llega despues. Nunca un 404.
export default function PanelPage() {
  return (
    <PantallaPendiente
      title="Panel"
      detalle="Las metricas siguen en la version de escritorio."
    />
  );
}
