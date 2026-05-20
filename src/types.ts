export interface Message {
  id: string;
  text?: string;
  imageUrl?: string;
  fileType?: string;
  timestamp: number;
  anonymousId: string;
  likes?: string[];
}
