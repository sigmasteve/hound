// Hound Chess (0238): the board from a FEN, the pieces' names, and what
// steps free. Pure; chessApi.ts is the client. The server checks every
// move (chess_legal), so nothing here decides what's legal.

export type ChessColor = 'w' | 'b';
export type ChessPieceType = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
export type ChessBotLevel = 'easy' | 'medium' | 'hard';

export interface ChessPiece {
  type: ChessPieceType;
  color: ChessColor;
  // Square index: 0 = a1, 63 = h8.
  sq: number;
}

export const FILES = 'abcdefgh';

export function sqName(sq: number): string {
  return `${FILES[sq % 8]}${Math.floor(sq / 8) + 1}`;
}

export function sqIndex(name: string): number {
  return FILES.indexOf(name[0]) + (Number(name[1]) - 1) * 8;
}

export function parseFen(fen: string): { pieces: ChessPiece[]; turn: ChessColor } {
  const [board, turn] = fen.trim().split(/\s+/);
  const pieces: ChessPiece[] = [];
  board.split('/').forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
      } else {
        const upper = ch.toUpperCase() as ChessPieceType;
        pieces.push({ type: upper, color: ch === upper ? 'w' : 'b', sq: rank * 8 + file });
        file += 1;
      }
    }
  });
  return { pieces, turn: turn === 'b' ? 'b' : 'w' };
}

export const PIECE_NAME: Record<ChessPieceType, string> = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
export const PIECE_VALUE: Record<ChessPieceType, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

export const BOT_NAME: Record<ChessBotLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export interface ChessNeeds {
  knightBishop: number;
  rook: number;
  queen: number;
  queenWorkout: number;
  moveHours: number;
}

// The four unlock steps, for the chips under the board.
export function unlockRows(free: string, steps: number, needs: ChessNeeds): { name: string; on: boolean; sub: string }[] {
  const left = (n: number) => `${Math.max(0, n - steps).toLocaleString('en-US')} to go`;
  return [
    { name: 'Pawns, king', on: true, sub: 'always' },
    { name: 'Knights, bishops', on: free.includes('N'), sub: free.includes('N') ? 'free' : left(needs.knightBishop) },
    { name: 'Rooks', on: free.includes('R'), sub: free.includes('R') ? 'free' : left(needs.rook) },
    {
      name: 'Queen',
      on: free.includes('Q'),
      sub: free.includes('Q') ? (steps >= needs.queen ? 'free' : 'free: workout') : `${left(needs.queen)}, or a workout`,
    },
  ];
}

// What a piece needs to move, for a resting piece's tag ("9k").
export function restingTag(type: ChessPieceType, needs: ChessNeeds): string | null {
  const n = type === 'N' || type === 'B' ? needs.knightBishop : type === 'R' ? needs.rook : type === 'Q' ? needs.queen : 0;
  if (!n) return null;
  return n % 1000 === 0 ? `${n / 1000}k` : `${(n / 1000).toFixed(1)}k`;
}

export interface ChessHistoryMove {
  ply: number;
  side: ChessColor;
  piece: ChessPieceType;
  from: string;
  to: string;
  promo: string | null;
  captured: ChessPieceType | null;
  check: boolean;
  auto: boolean;
}

// "Your knight to f3", "Priya's bishop takes your rook on e5, check".
export function moveLine(m: ChessHistoryMove, mine: boolean, theirName: string): string {
  const who = mine ? 'Your' : `${theirName}’s`;
  const what = PIECE_NAME[m.piece];
  if (m.piece === 'K' && Math.abs(FILES.indexOf(m.from[0]) - FILES.indexOf(m.to[0])) === 2) {
    return `${mine ? 'You' : theirName} castled ${m.to[0] === 'g' ? 'kingside' : 'queenside'}${m.check ? ', check!' : '.'}`;
  }
  const body = m.captured
    ? `${who} ${what} takes ${mine ? 'their' : 'your'} ${PIECE_NAME[m.captured]} on ${m.to}`
    : `${who} ${what} to ${m.to}`;
  const promo = m.promo ? `, and it’s a ${PIECE_NAME[m.promo.toUpperCase() as ChessPieceType] ?? 'queen'}` : '';
  return `${body}${promo}${m.check ? ', check!' : '.'}${m.auto ? ' (played by Hound: the 24 hours ran out)' : ''}`;
}

export function resultLine(result: 'white' | 'black' | 'draw' | null, method: string | null, me: ChessColor | null): string {
  if (!result) return '';
  const won = (result === 'white' && me === 'w') || (result === 'black' && me === 'b');
  const how =
    method === 'mate'
      ? 'by checkmate'
      : method === 'resign'
        ? 'by resignation'
        : method === 'timeout'
          ? 'on time: two missed turns'
          : method === 'time'
            ? 'on the pieces left when time ran out'
            : method === 'stalemate'
              ? 'stalemate'
              : method === 'dead'
                ? 'not enough left to mate'
                : method === 'fifty'
                  ? 'fifty moves without a capture'
                  : '';
  if (result === 'draw') return `A draw: ${how}.`;
  return won ? `You won ${how}!` : `You lost ${how}.`;
}
