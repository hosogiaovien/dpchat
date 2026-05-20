import React, { useEffect, useState, useRef } from "react";
import { Message } from "./types";
import { Send, Image as ImageIcon, Trash2, ExternalLink, User, Download, X, Play, Heart } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { db, storage } from "./firebase";
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Generate a random anonymous ID for the current session
const getAnonymousId = () => {
  let id = localStorage.getItem("chat_anonymous_id");
  if (!id) {
    id = Math.random().toString(36).substring(2, 10);
    localStorage.setItem("chat_anonymous_id", id);
  }
  return id;
};

const getImageUrl = (url: string) => {
  if (!url) return url;
  if (url.includes('/api/image')) {
    // legacy support if any old url has it
    return url;
  }
  if (url.includes('drive.google.com')) {
    let fileId = "";
    const matchId = url.match(/id=([^&]+)/);
    if (matchId) fileId = matchId[1];
    else {
      const matchD = url.match(/\/d\/(.+?)\//);
      if (matchD) fileId = matchD[1];
    }
    // Using thumbnail endpoint which is super reliable for images and bypasses strict cookie policies!
    if (fileId) return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
  }
  return url;
};

const getDrivePreviewUrl = (url: string) => {
  let fileId = "";
  const matchId = url.match(/id=([^&]+)/);
  if (matchId) {
    fileId = matchId[1];
  } else {
    const matchD = url.match(/\/d\/(.+?)\//);
    if (matchD) fileId = matchD[1];
  }
  if (fileId) {
    return `https://drive.google.com/file/d/${fileId}/preview`;
  }
  return url;
};

const getDriveDownloadUrl = (url: string) => {
  let fileId = "";
  const matchId = url.match(/id=([^&]+)/);
  if (matchId) {
    fileId = matchId[1];
  } else {
    const matchD = url.match(/\/d\/(.+?)\//);
    if (matchD) fileId = matchD[1];
  }
  if (fileId) {
    // For small files this forces a download.
    // For very large, it prompts a virus warning page, but opening in _blank is fine.
    return `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;
  }
  return url;
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [anonId] = useState(getAnonymousId());
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedMedia, setSelectedMedia] = useState<{url: string, type: string} | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Listen to Firestore messages collection
    const q = query(collection(db, "messages"), orderBy("timestamp", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = [];
      snapshot.forEach((doc) => {
        msgs.push({ id: doc.id, ...doc.data() } as Message);
      });
      setMessages(msgs);
      setErrorMsg(""); // Clear errors on success
    }, (error) => {
      console.error("Firestore error:", error);
      setErrorMsg("Lỗi kết nối Firebase (Có thể bạn chưa tạo Google Firestore Database hoặc chưa mở quyền): " + error.message);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Scroll to bottom on new messages
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    const newMessage = {
      text: inputText,
      timestamp: Date.now(),
      anonymousId: anonId,
    };

    setInputText("");
    
    try {
      await addDoc(collection(db, "messages"), newMessage);
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    
    try {
      const uploadPromises = Array.from(files).map(async (file: File) => {
        const formData = new FormData();
        formData.append("image", file);
        
        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();
        if (data.url) {
          const newMessage = {
            imageUrl: data.url,
            fileType: file.type || (file.name.match(/\.(mp4|webm|ogg|wmv|avi|mov|mkv)$/i) ? 'video/mp4' : 'image/jpeg'),
            timestamp: Date.now(),
            anonymousId: anonId,
          };
          await addDoc(collection(db, "messages"), newMessage);
        } else if (data.error) {
          console.error("Upload failed for file " + file.name + ": " + data.error);
        }
      });

      await Promise.allSettled(uploadPromises);
    } catch (error) {
      console.error("Upload failed", error);
      alert("Error during upload.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteMessage = async (msg: Message) => {
    try {
      if (msg.imageUrl && msg.imageUrl.includes('drive.google.com')) {
        // Attempt to delete it from Drive via our backend API
        const res = await fetch("/api/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: msg.imageUrl })
        });
        const data = await res.json();
        if (!data.success) {
          console.error("Lỗi xóa file trên Drive:", data.error);
          // Vẫn cho phép xóa tin nhắn nếu có lỗi
        }
      }
      await deleteDoc(doc(db, "messages", msg.id));
    } catch (error) {
      console.error("Error deleting message:", error);
    }
  };

  const toggleLike = async (msg: Message) => {
    try {
      const messageRef = doc(db, "messages", msg.id);
      const likes = msg.likes || [];
      if (likes.includes(anonId)) {
        await updateDoc(messageRef, { likes: arrayRemove(anonId) });
      } else {
        await updateDoc(messageRef, { likes: arrayUnion(anonId) });
      }
    } catch (error) {
      console.error("Error toggling like:", error);
    }
  };

  // Helper to parse links and make them clickable
  const renderText = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.split(urlRegex).map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline hover:text-blue-300 break-all inline-flex items-center gap-1"
          >
            {part} <ExternalLink size={12} />
          </a>
        );
      }
      return part;
    });
  };

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-zinc-100 font-sans relative">
      {/* Header */}
      <header className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center">
            <User size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Chat of Đông Phương</h1>
            <p className="text-xs text-zinc-500 font-mono">ID: {anonId}</p>
          </div>
        </div>
        <div className="text-xs font-mono text-zinc-500 bg-zinc-800 px-2 py-1 rounded">
          {messages.length} messages
        </div>
      </header>

      {errorMsg && (
        <div className="bg-red-500/20 text-red-200 text-sm p-4 text-center border-b border-red-500/50">
          {errorMsg}
        </div>
      )}

      {/* Messages */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-4 scroll-smooth"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => {
            const isMe = msg.anonymousId === anonId;
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={cn(
                  "flex flex-col max-w-[80%]",
                  isMe ? "ml-auto items-end" : "mr-auto items-start"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {isMe ? "You" : `User ${msg.anonymousId}`}
                  </span>
                </div>

                <div className="flex flex-col relative group">
                  <div className={cn(
                    "px-4 py-3 rounded-2xl shadow-lg transition-colors overflow-hidden",
                    isMe 
                      ? "bg-indigo-600 text-white rounded-tr-none" 
                      : "bg-zinc-800 text-zinc-100 rounded-tl-none"
                  )}>
                    {msg.text && (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {renderText(msg.text)}
                      </p>
                    )}
                    {msg.imageUrl && (
                      msg.fileType?.startsWith('video/') ? (
                        <div className="relative mt-2 block">
                          <div 
                            className="relative cursor-pointer bg-black rounded-lg overflow-hidden flex items-center justify-center max-w-[400px] max-h-[500px] w-full"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMedia({ url: msg.imageUrl || "", type: 'video' });
                            }}
                          >
                            <img 
                              src={getImageUrl(msg.imageUrl)} 
                              alt="Video" 
                              referrerPolicy="no-referrer"
                              className="relative w-full h-auto min-h-[150px] max-h-[500px] object-cover opacity-70 group-hover:opacity-50 transition-all block text-transparent"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                if (e.currentTarget.parentElement) {
                                  e.currentTarget.parentElement.style.aspectRatio = '16/9';
                                }
                              }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="bg-black/60 p-3 rounded-full text-white backdrop-blur-sm transition-transform">
                                <Play size={24} fill="currentColor" />
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="relative mt-2 block">
                          <img 
                            src={getImageUrl(msg.imageUrl)} 
                            alt="Shared media" 
                            referrerPolicy="no-referrer"
                            className="rounded-lg max-w-full h-auto cursor-pointer hover:brightness-110 transition-all block max-h-[400px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMedia({ url: getImageUrl(msg.imageUrl || ""), type: 'image' });
                            }}
                          />
                        </div>
                      )
                    )}
                  </div>
                  
                  {/* Action Bar */}
                  <div className={cn(
                    "flex items-center gap-4 mt-2 px-1",
                    isMe ? "justify-end" : "justify-start"
                  )}>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    
                    <button 
                      onClick={() => toggleLike(msg)}
                      className={cn(
                        "flex items-center gap-1.5 text-[11px] transition-colors",
                        (msg.likes?.includes(anonId)) ? "text-red-400" : "text-zinc-500 hover:text-red-400"
                      )}
                    >
                      <Heart size={14} className={cn((msg.likes?.includes(anonId)) && "fill-current")} />
                      {msg.likes && msg.likes.length > 0 && <span className="font-medium text-xs">{msg.likes.length}</span>}
                    </button>

                    {msg.imageUrl && (
                      <a 
                        href={getDriveDownloadUrl(msg.imageUrl)} 
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-500 hover:text-white transition-colors"
                        title="Download media"
                      >
                        <Download size={14} />
                      </a>
                    )}

                    {(isMe || true) && (
                      <button 
                        onClick={() => deleteMessage(msg)}
                        className="text-zinc-500 hover:text-red-400 transition-colors"
                        title="Delete message"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Input Area */}
      <footer className="p-4 bg-zinc-900/80 backdrop-blur-md border-t border-zinc-800 shrink-0">
        <form 
          className="max-w-4xl mx-auto flex items-end gap-3"
          onSubmit={sendMessage}
        >
          <div className="flex-1 relative bg-zinc-800 rounded-2xl border border-zinc-700 focus-within:border-indigo-500 transition-colors">
            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Type a message or paste a link..."
              className="w-full bg-transparent border-none text-zinc-100 px-4 py-3 text-sm focus:ring-0 placeholder:text-zinc-600 resize-none min-h-[44px] max-h-[200px]"
            />
            {isUploading && (
              <div className="absolute inset-0 bg-zinc-800/80 backdrop-blur-sm flex items-center justify-center rounded-2xl">
                <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-xl bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all disabled:opacity-50"
            >
              <ImageIcon size={20} />
            </button>
            <button
              type="submit"
              disabled={!inputText.trim() || isUploading}
              className="p-3 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-all disabled:opacity-50 disabled:bg-zinc-800 shadow-lg shadow-indigo-500/20"
            >
              <Send size={20} />
            </button>
          </div>
          
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*,video/*"
            multiple
            className="hidden"
          />
        </form>
        <p className="text-[10px] text-zinc-600 text-center mt-3 font-mono">
          Media is stored on Google Drive forever. No login required.
        </p>
      </footer>

      {/* Lightbox Modal */}
      <AnimatePresence>
        {selectedMedia && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 md:p-10"
            onClick={() => setSelectedMedia(null)}
          >
            <div className="relative max-w-full max-h-full flex items-center justify-center">
              <button 
                className="absolute -top-12 right-0 text-zinc-400 hover:text-white transition-colors bg-white/10 p-2 rounded-full z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedMedia(null);
                }}
              >
                <X size={24} />
              </button>
              {selectedMedia.type === 'video' ? (
                <div className="relative w-[90vw] max-w-5xl h-[80vh] bg-transparent rounded shadow-2xl mt-8 lg:mt-0 flex items-center justify-center">
                  <iframe 
                    src={getDrivePreviewUrl(selectedMedia.url)} 
                    allow="autoplay"
                    allowFullScreen
                    className="w-full h-full border-none rounded-lg bg-black"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : (
                <img 
                  src={selectedMedia.url} 
                  alt="Enlarged media" 
                  className="max-w-full max-h-[85vh] rounded object-contain mt-8 lg:mt-0 shadow-2xl" 
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
