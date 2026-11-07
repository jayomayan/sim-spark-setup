import { strongPassword, usernameSchema } from "@/lib/invitations";

const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?+-_"];

function randomIndex(limit: number): number {
  const values = new Uint32Array(1);
  const ceiling = Math.floor(0x100000000 / limit) * limit;
  let value: number | undefined;
  do {
    globalThis.crypto.getRandomValues(values);
    value = values[0];
  } while (value === undefined || value >= ceiling);
  return value % limit;
}

export function generateTemporaryPassword(): string {
  const alphabet = groups.join("");
  const characters = groups.map((group) => group[randomIndex(group.length)]);
  while (characters.length < 20) characters.push(alphabet[randomIndex(alphabet.length)]);
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return strongPassword.parse(characters.join(""));
}

export function formatInvitationCredentials(username: string, password: string): string {
  return `Username: ${usernameSchema.parse(username)}\nTemporary password: ${strongPassword.parse(password)}`;
}