import Discord, { Collection, Role, Snowflake, GuildMember, Message, TextChannel, Channel, MessageReaction } from "discord.js"
import ObjectCache from "./ObjectCache"
import { channelCache, roleCache } from "../app-bot"
import { Applicant, getApplicant, saveApplicant, removeApplicant } from "./Applicant"
import { appResponse } from "./text"
import Storage from "node-persist"

// set up global error handlers
process.on("unhandledRejection", (error) => {
  console.log("unhandledRejection: ", error)
})

export async function initStorage() {

  await Storage.init()

  if (!await Storage.getItem("officerRole")) await Storage.setItem("officerRole", "officer")
  if (!await Storage.getItem("applicantRole")) await Storage.setItem("applicantRole", "applicant")
  if (!await Storage.getItem("appsChannel")) await Storage.setItem("appsChannel", "apps")
  if (!await Storage.getItem("applicantsCategory")) await Storage.setItem("applicantsCategory", "applicants")
}

export async function changeSetting(msg: Message, command: string) {

  if (!msg.member?.hasPermission("ADMINISTRATOR")) return await msg.channel.send("You must have Administrator permissions to run this command.")
  
  const match = new RegExp(`(!${command})\\s(.+)`, "g").exec(msg.content)
  if (!match) return await msg.channel.send(`Invalid !${command} command.`).catch(console.error)
  await Storage.updateItem(`${command}`, match[2])
  await msg.channel.send(`${command} has been set to: \`${match[2]}\``).catch(console.error)
}

export async function isMod(member: GuildMember) {
  const roles = member.roles.cache
  return roles.has(roleCache.getOrThrow(await Storage.getItem("officerRole")).id)
}

export function collectionToCacheByName<T extends { name: string }>(
  collection: Collection<Snowflake, T>
): ObjectCache<T> {
  const entries = collection.entries()
  const byName: Array<[string, T]> = Array.from(entries).map(([, item]) => {
    const key = item.name.toLowerCase()
    return [key, item]
  })

  return new ObjectCache(byName)
}

export function parseApplicantName(tag: string): string {
  const match = /(\w+)#(\d+)/g.exec(tag)

  if (!match) throw Error(`unable to match Discord Tag: ${tag}`)

  let name = match[1] + match[2]
  return name.toLowerCase()
}

export async function handleApp(msg: Message, guild: Discord.Guild): Promise<Applicant> {
  const fields = msg.embeds[0].fields
  let tag

  for (let e of fields) {
    if (e.name == "Discord Tag") {
      tag = e.value
      break
    }
  }

  if (!tag) throw Error("tag is undefined")

  const name = parseApplicantName(tag)

  try {
    const channel = await guild.channels.create(name, {
      parent: channelCache.getOrThrow(await Storage.getItem("applicantsCategory")).id,
    })
    return {
      tag,
      name,
      appMessageID: msg.id,
      channelID: channel.id,
    }
  } catch (e) {
    throw Error(`failed to create channel for ${tag} | ${e}`)
  }
}

export async function handlePermissions(member: GuildMember) {
  const name = parseApplicantName(member.user.tag)

  const applicant = await getApplicant(name)
  if (!applicant) throw Error(`applicant does not exist: ${name}`)

  applicant.memberID = member.id
  await saveApplicant(applicant)

  member.roles.add(roleCache.getOrThrow(await Storage.getItem("applicantRole")).id)

  const channel = member.guild.channels.resolve(applicant.channelID)
  if (!channel) throw Error(`channel does not exist for applicant: ${applicant.tag}`)

  await channel.createOverwrite(member.user, { VIEW_CHANNEL: true })

  if (!isTextChannel(channel)) throw Error(`applicant channel is not text channel for applicant: ${applicant.tag}`)

  await channel.send(appResponse(applicant)).catch(console.error)
}

export function isTextChannel(channel: Channel): channel is TextChannel {
  return channel.type === "text"
}

export async function handleReaction(reaction: MessageReaction, applicant: Applicant, channel: TextChannel) {

  reaction.users.cache.each(async user => {

    const guildMember = reaction.message.guild?.members.resolve(user.id)
    if (!guildMember) throw Error(`guild member does not exist for user: ${user.tag} | ${user.id}`)

    if (user.id == applicant.memberID || await isMod(guildMember)) {

      await channel.delete().catch(console.error)

      if (!applicant.memberID) return
      const applicantMember = reaction.message.guild?.members.resolve(applicant.memberID)
      if (!applicantMember) throw Error(`member does not exist: ${applicant.tag} | ${applicant.memberID}`)

      await applicantMember.kick().catch(console.error)

      await removeApplicant(applicant)
    }
  })
}