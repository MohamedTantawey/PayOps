export function ProductArt({slug,name}:{slug:string;name:string}) {
 const known=['aurora-hoodie','nebula-sneakers','orbit-cap','pulse-tee','echo-backpack','drift-jacket'];
 return known.includes(slug)?<img className="payops-product-art po-product-photo" src={`/images/products/${slug}.webp`} alt={`${name}, AI-generated photographic concept`} width={900} height={900} loading="eager"/>:<div className="payops-product-art po-product-photo-fallback" role="img" aria-label={`${name}, image unavailable`}>{name}</div>;
}
