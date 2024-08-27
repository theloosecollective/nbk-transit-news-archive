import { AxiosError } from "npm:axios"
import { extractors } from "../extractors/index.ts"
import { spreadsheet } from "../spreadsheet.ts"
import { formatDate } from "../utils.ts"
import * as HTMLEntities from "https://deno.land/std@0.224.0/html/entities.ts"
import { ExtractMetadataOptions } from "../../main.ts"

export async function extractMetadataFromWebpage(args: ExtractMetadataOptions) {
	const alreadySeenDomains = new Set<string>()

	await spreadsheet.loadInfo()
	const sheet = spreadsheet.sheetsByTitle["Other"]

	interface Row {
		to: string
		// Media: string // publication (e.g. NY Times)
		Date: string // date published
		Byline: string // author
		Headline: string // article headline
		URL: string // url of the article
	}
	const rows = await sheet.getRows<Row>()

	for (const row of rows) {
		if (row.get("Headline")) {
			continue
		}

		const url = row.get("URL")
		const u = new URL(url)
		const domain = u.hostname

		if (args.domain && !domain.includes(args.domain)) {
			continue
		}

		if (args.processOnce) {
			if (alreadySeenDomains.has(domain)) {
				continue
			} else {
				alreadySeenDomains.add(domain)
			}
		}

		console.log(`${row.rowNumber} - extracting data from ${domain}`)

		let foundHeadline = ""
		let foundPublicationDate = ""
		let foundAuthors = ""
		let foundSiteTitle = ""

		for (const extractor of extractors) {
			if (
				foundHeadline && foundPublicationDate && foundAuthors && foundSiteTitle
			) {
				break
			}

			try {
				const {
					headline,
					publicationDate,
					author,
					siteTitle,
				} = await extractor(url)

				if (!foundHeadline && headline) {
					foundHeadline = headline
				}
				if (!foundPublicationDate && publicationDate) {
					foundPublicationDate = publicationDate
				}
				if (!foundAuthors && author) {
					foundAuthors = author
				}
				if (!foundSiteTitle && siteTitle) {
					foundSiteTitle = siteTitle
				}
			} catch (e) {
				console.error(
					`${row.rowNumber} - error extracting data extractor:${extractor.name} domain:${domain}`,
					e,
				)
				continue
			}
		}

		row.assign({
			to: HTMLEntities.unescape(row.get("to").trim() || foundSiteTitle),
			Headline: row.get("Headline") ||
				HTMLEntities.unescape(foundHeadline).replace("&bull;", "•"),
			Date: row.get("Date") || formatDate(foundPublicationDate),
			Byline: row.get("Byline") || HTMLEntities.unescape(foundAuthors),

			// These should be left alone, but .assign() requires us to set them
			URL: url,
		})

		let attempts = 0
		while (true) {
			try {
				await row.save()
				break
			} catch (e: unknown) {
				if (e instanceof AxiosError && e.response?.status === 429) {
					attempts++
					console.log("rate limited, waiting 5 seconds. attempts: ", attempts)
					await new Promise((resolve) => setTimeout(resolve, 5000))
					continue
				}

				console.error(`${row.rowNumber} - unknown error saving row`, e)
				break
			}
		}
		attempts = 0

		console.log(" ----------------------------------------")
	}
}