import { Chat } from "@/components/movil/chat";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Chat conversationId={id} />;
}
