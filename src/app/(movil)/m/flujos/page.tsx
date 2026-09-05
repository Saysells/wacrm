import { PantallaPendiente } from "@/components/movil/screen";

// Pantalla vacia con su titulo y su entrada en el tabbar. La sesion 1
// construye Bandeja y Chat; esta llega despues. Nunca un 404.
export default function FlujosPage() {
  return (
    <PantallaPendiente
      title="Flujos"
      detalle="Ver y pausar los flujos sigue en la version de escritorio."
    />
  );
}
