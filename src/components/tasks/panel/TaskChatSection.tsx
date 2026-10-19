import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, MessageSquare, Send } from 'lucide-react';
import { useCollection, useMutation } from '../../../hooks/useFirestore';
import { useAuth } from '../../../contexts/AuthContext';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';

/** "Chat" — a live conversation about this task, separate from the comment
 *  log. Collapsed by default: the listener only runs while it is open. */
const TaskChatSection: React.FC<{
  taskId: string;
  getUserDisplayName: (userId: string) => string;
}> = ({ taskId, getUserDisplayName }) => {
  const { user } = useAuth();
  const messageMutation = useMutation<any>('messages');
  const [chatMessageText, setChatMessageText] = useState('');
  const [showChat, setShowChat] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const { data: taskMessages, loading: isLoadingMessages } = useCollection<any>('messages', {
    where: [{ field: 'taskId', operator: '==', value: taskId }],
    orderBy: { field: 'createdAt', direction: 'asc' },
    // Query server-side by taskId (uses messages: taskId,createdAt index) instead of
    // downloading the whole team's messages and filtering client-side.
    skipTeamFilter: true,
    // Only listen while the panel is actually open. It used to subscribe on every
    // task open, so most tasks paid for a listener nobody looked at.
    skip: !showChat,
  });

  // Reset the draft ONLY when switching to a different task.
  useEffect(() => {
    setChatMessageText('');
  }, [taskId]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current && showChat) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [taskMessages, showChat]);

  const handleSendChatMessage = async () => {
    if (!chatMessageText.trim() || !user) return;

    try {
      await messageMutation.create({
        content: chatMessageText,
        senderId: user.uid,
        taskId,
        isRead: false,
      });
      setChatMessageText('');
    } catch (err) {
      console.error('Failed to send message:', err);
      // Message stays in input so user can retry
    }
  };

  return (
    <div className="pt-4 border-t">
      <button
        type="button"
        onClick={() => setShowChat(v => !v)}
        aria-expanded={showChat}
        className="w-full flex items-center justify-between mb-3 group"
      >
        <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          Chat
          {taskMessages.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({taskMessages.length})</span>
          )}
        </h4>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform ${showChat ? 'rotate-180' : ''}`}
        />
      </button>

      {showChat && (
        <div className="space-y-2">
          <div
            ref={chatScrollRef}
            className="max-h-64 overflow-y-auto space-y-2 pr-1"
          >
            {isLoadingMessages ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Po ngarkohen mesazhet...
              </div>
            ) : taskMessages.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Asnjë mesazh. Shkruaj të parin.
              </p>
            ) : (
              taskMessages.map((m: any) => {
                const mine = m.senderId === user?.uid;
                const at = m.createdAt instanceof Date ? m.createdAt : null;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words ${
                        mine
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : 'bg-muted text-foreground rounded-bl-sm'
                      }`}
                    >
                      {!mine && (
                        <p className="text-[11px] font-medium opacity-70 mb-0.5">
                          {getUserDisplayName(m.senderId)}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      {at && (
                        <p className={`text-[10px] mt-0.5 ${mine ? 'opacity-70' : 'text-muted-foreground'}`}>
                          {at.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={chatMessageText}
              onChange={(e) => setChatMessageText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendChatMessage();
                }
              }}
              placeholder="Shkruaj një mesazh..."
              className="flex-1 text-base sm:text-sm"
            />
            <Button
              size="icon"
              onClick={handleSendChatMessage}
              disabled={!chatMessageText.trim()}
              aria-label="Dërgo mesazhin"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskChatSection;
