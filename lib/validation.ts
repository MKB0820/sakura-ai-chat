import { z } from 'zod'

export const emailSchema = z
  .string({ error: '请输入邮箱' })
  .trim()
  .toLowerCase()
  .email({ error: '邮箱格式不正确' })

export const passwordSchema = z
  .string({ error: '请输入密码' })
  .min(8, '密码至少需要 8 位')
  .max(128, '密码不能超过 128 位')

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, '请输入密码'),
})

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
