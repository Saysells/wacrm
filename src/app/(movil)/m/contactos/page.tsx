import { PantallaPendiente } from "@/components/movil/screen";

// Pantalla vacia con su titulo y su entrada en el tabbar. La sesion 1
// construye Bandeja y Chat; esta llega despues. Nunca un 404.
export default function ContactosPage() {
  return (
    <PantallaPendiente
      title="Contactos"
      detalle="Las fichas y la busqueda de contactos siguen en la version de escritorio."
    />
  );
}
