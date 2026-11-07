import { strongPassword, usernameSchema } from "@/lib/invitations";

const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?+-_"];

function randomIndex(limit: number): number {
  const values = new Uint32Array(1);
  const ceiling = Math.floor(0x100000000 / limit) * limit;
  do { globalThis.crypto.getRandomValues(values); } while (values[0] >= ceiling);
  return values[0] % limit;
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