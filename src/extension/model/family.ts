import { MODEL_FAMILIES, type ModelFamily } from '../../shared/protocol';

export function modelFamily(model: string): ModelFamily {
  const id = model.toLowerCase();
  return MODEL_FAMILIES.find((family) => family !== 'other' && id.includes(family)) ?? 'other';
}
