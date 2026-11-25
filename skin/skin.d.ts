/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 */
import { Account } from '../../types/account.js';
import { IAvatar, ICape, ISkin } from '../../types/skin.js';
export default class Skin {
    private readonly account;
    private cached;
    private skins;
    private capes;
    private avatar;
    /**
     * Manage the player's skin, avatar and cape.
     * @param account The account of the player (must be authenticated with EML Lib's authentication
     * system).
     */
    constructor(account: Account);
    /**
     * @deprecated Use `getSkins()` instead.
     */
    getSkin(active?: boolean): Promise<ISkin[]>;
    /**
     * Get the player's skin. If the player has no skin, an empty array is returned.
     *
     * **Note:** Data returned by this method may be cached. Call `reload()` to fetch the latest data
     * from the server.
     *
     * @param active Whether to only return active skins (i.e., the skin currently used by the
     * player). If `false`, all skins are returned, including inactive ones.
     * @returns The list of the player's skins.
     */
    getSkins(active?: boolean): Promise<ISkin[]>;
    /**
     * @deprecated Use `getCapes()` instead.
     */
    getCape(active?: boolean): Promise<ICape[]>;
    /**
     * Get the player's cape. If the player has no cape, an empty array is returned.
     *
     * **Note:** Data returned by this method may be cached. Call `reload()` to fetch the latest data
     * from the server.
     *
     * @param active Whether to only return active capes (i.e., the cape currently used by the
     * player). If `false`, all capes are returned, including inactive ones.
     * @returns The list of the player's capes.
     */
    getCapes(active?: boolean): Promise<ICape[]>;
    /**
     * Get the player's avatar. If the player has no avatar, `null` is returned.
     *
     * **Note:** Data returned by this method may be cached. Call `reload()` to fetch the latest data
     * from the server.
     *
     * @returns The player's avatar.
     */
    getAvatar(): Promise<IAvatar | null>;
    /**
     * Reload the player's skin, cape and avatar data from the server. This is useful to get the
     * latest data after the player has changed their skin or cape, or if you want to make sure you
     * have the latest data from the server.
     */
    reload(): Promise<void>;
    /**
     * Upload a new skin for the player and activate it. Cache is automatically updated after a
     * successful update.
     * @param source The source file of the skin. The image should be a `.png` file of the skin,
     * and must follow the standard Minecraft skin format (64x64 pixels, or 64x32 pixels for legacy
     * skins). You can also provide a URL to the skin image.
     * @param variant The skin variant to use. This is only relevant for Minecraft accounts that have
     * both a classic and a slim skin. If the account only has one skin variant, this parameter is
     * ignored.
     */
    updateSkin(source: string | File | Blob, variant?: 'classic' | 'slim'): Promise<void>;
    /**
     * Upload a new cape for the player and activate it. Cache is automatically updated after a
     * successful update.
     *
     * **Attention!** This method only works for Azuriom accounts.
     *
     * @param source The source file of the cape. The image should be a `.png` file of the cape, and
     * must follow the standard Minecraft cape format (64x32 pixels). You can also provide a URL
     * to the cape image.
     */
    updateCape(source: string | File | Blob): Promise<void>;
    /**
     * Delete the player's cape. Cache is automatically updated after a successful update.
     *
     * **Note:** Microsoft accounts doesn't allow custom capes. Please use `hideCape()` to hide the
     * player's cape instead of deleting it, as they don't support deleting capes.
     */
    deleteCape(): Promise<void>;
    /**
     * Switch the player's active cape.
     *
     * **Note:** This method only works for Microsoft accounts. Please use `updateCape()` to update
     * the cape for other account types, as they don't support multiple capes.
     *
     * @param capeId The ID of the cape to activate. You can get the list of the player's capes and
     * their IDs with the `getCape()` method.
     */
    switchCape(capeId: string): Promise<void>;
    /**
     * Hide the player's cape. Cache is automatically updated after a successful update.
     *
     * **Note:** This method only works for Microsoft accounts. Please use `deleteCape()` to delete
     * the cape for other account types, as they don't support hiding capes.
     */
    hideCape(): Promise<void>;
    private fetchFromMicrosoft;
    private fetchFromYggdrasil;
    private fetchFromAzuriom;
    private uploadSkinToMicrosoft;
    private uploadSkinToYggdrasil;
    private uploadSkinToAzuriom;
    private switchCapeOnMicrosoft;
    private hideCapeOnMicrosoft;
    private deleteCapeFromYggdrasil;
    private uploadCapeToAzuriom;
    private deleteCapeFromAzuriom;
    private getAvatarFromSkin;
}
